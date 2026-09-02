import { NextRequest } from "next/server";
import { connectDB, registerBackgroundDbWork } from "@/lib/db";
import { Link, LIVE_LINK_FILTER, type ILinkTarget } from "@/models/Link";
import { Click } from "@/models/Click";
import { hashIP, encryptIP, getClientIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { timingSafeEqualStr } from "@/lib/utils";
import { PRIMARY_DOMAIN, normaliseHost } from "@/lib/domains";
import { isDomainServable } from "@/lib/domain-cache";
import { buildCacheEntry, refreshCachedLink, type CachedLink } from "@/lib/link-cache";
import { deferUntilResponseSent } from "@/lib/worker-context";
import { platformFromUA, parseHttpUrl } from "@/lib/deeplink";
import { UAParser } from "ua-parser-js";

/**
 * The URL this request should be sent to.
 *
 * `Link.url` stays the answer unless the link carries an override for the
 * caller's platform, so a link with no targets (every link that exists today)
 * resolves byte-identically. An override is only honoured when it is a real
 * http(s) URL: a malformed or non-http entry falls back rather than being
 * handed to a redirect.
 */
function resolveTargetUrl(
  fallbackUrl: string,
  targets: ILinkTarget[] | undefined,
  userAgent: string
): string {
  if (!targets || targets.length === 0) return fallbackUrl;

  const platform = platformFromUA(UAParser(userAgent).os.name);
  const match = targets.find((t) => t.platform === platform);
  if (!match) return fallbackUrl;

  return parseHttpUrl(match.url) ? match.url : fallbackUrl;
}

/**
 * Brings the link cache into line with what this resolution found, after the
 * response has gone out.
 *
 * Called on every outcome, not only the successful one. The 404 and 410 paths
 * pass `null` and therefore *delete* the key, which is what makes the middleware's
 * background call a repair mechanism rather than a refresh: a link that was
 * removed, expired or edited while a cached entry was live is corrected by the
 * very next request for it, even if the writer's own invalidation was lost.
 *
 * Skipped entirely off the primary domain, where nothing is ever cached, so a
 * custom-domain redirect does not pay a KV round trip to delete a key that
 * cannot exist.
 */
function syncLinkCache(
  domain: string,
  keyword: string,
  entry: { value: CachedLink; ttlSeconds: number } | null
): void {
  if (domain !== PRIMARY_DOMAIN) return;

  const work = refreshCachedLink(domain, keyword, entry).catch((err) => {
    captureError(err, { route: "internal/resolve", domain, keyword, stage: "cache-refresh" });
  });

  // Nothing to defer to under plain Node, where there is no KV binding either,
  // so the work has already resolved to a no-op and awaiting it is free.
  if (!deferUntilResponseSent(work)) void work;
}

/**
 * Internal resolve endpoint called by middleware.
 * Looks up a keyword, logs the click, and returns redirect info.
 */
export async function GET(request: NextRequest) {
  // Only allow calls from internal middleware — fail closed if the secret
  // is not configured, never skip the check.
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const provided = request.headers.get("x-internal-secret");
  if (!provided || !timingSafeEqualStr(provided, internalSecret)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const keyword = request.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return Response.json({ error: "Missing keyword" }, { status: 400 });
  }

  // The middleware always sends `domain`. An absent value falls back to the
  // primary domain rather than querying by keyword alone, so a caller can never
  // trigger an unscoped lookup by omitting the parameter.
  const domain = normaliseHost(request.nextUrl.searchParams.get("domain") ?? "") || PRIMARY_DOMAIN;

  // Rate limit by IP: 120 requests per minute
  const clientIP = getClientIP(request.headers) || "unknown";
  const rl = await rateLimit(`resolve:${hashIP(clientIP)}`, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  await connectDB();

  // A custom domain only resolves while its Domain record is `active`. Anything
  // pending, verifying, failed, or suspended returns 404 and never reveals that
  // links exist behind it. Cached for 60s, degrading to MongoDB if Redis is down.
  if (domain !== PRIMARY_DOMAIN) {
    const servable = await isDomainServable(domain);
    if (!servable) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  }

  // A link stamped with `domainDetachedAt` belonged to a previous owner of this
  // hostname and must never resolve again.
  const link = await Link.findOne({ domain, keyword, ...LIVE_LINK_FILTER }).lean();
  if (!link) {
    syncLinkCache(domain, keyword, null);
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Check expiration
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    syncLinkCache(domain, keyword, null);
    return Response.json({ error: "Link expired" }, { status: 410 });
  }

  // Log click asynchronously (fire-and-forget) — never let a click-logging
  // failure (e.g. encryptIP throwing on a misconfigured IP_ENCRYPTION_KEY)
  // block or crash the redirect response itself.
  try {
    const rawIP = clientIP;
    const userAgent = request.headers.get("user-agent") || "";
    const referrer = request.headers.get("referer") || "";
    const countryCode = request.headers.get("x-geo-country") || "";

    const ua = UAParser(userAgent);
    const browser = ua.browser.name || "";
    const os = ua.os.name || "";
    const { iv: ipIv, ciphertext: ipRaw } =
      rawIP !== "unknown" ? encryptIP(rawIP) : { iv: "", ciphertext: "" };

    // Registered rather than left bare: on workerd the request's connection is
    // closed once the response is sent, and unregistered work is cancelled with
    // the request context, so an unregistered write would be dropped.
    const clickWrite = Promise.all([
      Click.create({
        domain,
        keyword,
        referrer,
        userAgent,
        ipRaw,
        ipIv,
        countryCode,
        browser,
        os,
      }),
      Link.updateOne({ domain, keyword, ...LIVE_LINK_FILTER }, { $inc: { clicks: 1 } }),
    ]).catch((err) => {
      captureError(err, { route: "internal/resolve", domain, keyword });
    });
    registerBackgroundDbWork(clickWrite);
  } catch (err) {
    captureError(err, { route: "internal/resolve", domain, keyword, stage: "click-log-setup" });
  }

  // Populate the cache the middleware reads, so the next request for this
  // keyword costs neither the hop back into this endpoint nor a MongoDB
  // handshake. A link that is not cacheable (deeplink targets, about to expire)
  // resolves to null here and has any entry it still holds removed.
  syncLinkCache(domain, keyword, buildCacheEntry(domain, PRIMARY_DOMAIN, link));

  return Response.json({
    url: resolveTargetUrl(link.url, link.targets, request.headers.get("user-agent") || ""),
    statusCode: link.statusCode || 301,
    isPasswordProtected: link.isPasswordProtected,
    // Sent so the middleware can compose the incoming path and query onto the
    // target. Both default false on the model, so an existing link keeps
    // getting exactly the URL stored on it.
    forwardPath: link.forwardPath === true,
    forwardQuery: link.forwardQuery === true,
  });
}
