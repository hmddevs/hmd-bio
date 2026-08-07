import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link, LIVE_LINK_FILTER } from "@/models/Link";
import { Click } from "@/models/Click";
import { hashIP, encryptIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { timingSafeEqualStr } from "@/lib/utils";
import { PRIMARY_DOMAIN, normaliseHost } from "@/lib/domains";
import { isDomainServable } from "@/lib/domain-cache";
import { UAParser } from "ua-parser-js";

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
  const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
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
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Check expiration
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
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

    Promise.all([
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
  } catch (err) {
    captureError(err, { route: "internal/resolve", domain, keyword, stage: "click-log-setup" });
  }

  return Response.json({
    url: link.url,
    statusCode: link.statusCode || 301,
    isPasswordProtected: link.isPasswordProtected,
  });
}
