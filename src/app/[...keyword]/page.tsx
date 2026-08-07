import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Link, LIVE_LINK_FILTER } from "@/models/Link";
import { Click } from "@/models/Click";
import { encryptIP, hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { PRIMARY_DOMAIN, domainFromHost } from "@/lib/domains";
import { isDomainServable } from "@/lib/domain-cache";
import { getDomainConfig } from "@/lib/domain-config-cache";
import { fallbackKeywordFromSegments } from "@/lib/deeplink";
import { UAParser } from "ua-parser-js";

/**
 * Server-rendered fallback for short-link resolution — only reached when
 * proxy.ts's call to /api/internal/resolve is unreachable (cold start,
 * timeout, network error). Mirrors that route's lookup and expiry/password
 * semantics directly against MongoDB.
 *
 * A catch-all rather than a single dynamic segment, so that a domain serving
 * its links under a path prefix degrades the same way a root link does. Until
 * this was a catch-all, `/l/<code>` had no route to fall through to and 404ed
 * during exactly the outage the fallback exists for, which is the failure mode
 * that hid a broken internal fetch in production between #28 and #30.
 *
 * Widening the route means paths that previously had no match now render here.
 * Nothing that resolves today changes: static and more specific routes still
 * win over a catch-all, and `fallbackKeywordFromSegments` returns null for
 * every multi-segment path that is not a genuine prefixed link, which lands on
 * the same 404 those paths already produced.
 */
export default async function KeywordPage({
  params,
}: {
  params: Promise<{ keyword: string[] }>;
}) {
  const { keyword: segments } = await params;

  // The host has to be read here too: when the middleware is bypassed, nothing
  // upstream has scoped this lookup to a domain.
  const requestHeaders = await headers();
  const domain = domainFromHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  );

  const depth = segments?.length ?? 0;
  const isSingleSegment = depth === 1;

  // Structural, and first, because it holds for every host: a link this route
  // can serve is either a root keyword or a prefixed one, so it is never more
  // than two segments deep. Answering that before `connectDB` takes the whole
  // deep-scanner class off the database. Without it, a loop over
  // /assets/$RANDOM/$RANDOM on a custom domain is a Mongo query amplifier
  // during exactly the outage this fallback exists for, since it arrives
  // unauthenticated and unrated: the middleware matcher skips some of these
  // paths outright, and the proxy hands the rest straight to Next.
  if (depth === 0 || depth > 2) {
    notFound();
  }

  // A path prefix is a per-tenant setting, so the platform's own host can never
  // have one. Answered before connecting too, so the two-segment junk a
  // catch-all now attracts on the primary domain costs no database work.
  if (!isSingleSegment && domain === PRIMARY_DOMAIN) {
    notFound();
  }

  // Read before the limiter, because the limiter keys on it, and reused for
  // click logging further down.
  const clientIP = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Same key, same limit, same window as /api/internal/resolve, deliberately.
  // This page is reachable without the middleware ever running: the matcher's
  // lookahead is a raw prefix test, so a keyword such as "iconoclast" skips it
  // and arrives here directly. Sharing one bucket with the resolve endpoint
  // means a caller cannot spend 120/min on each path and get 240, and it caps
  // the two Mongo writes below that were previously unmetered on this route.
  //
  // Placed before `connectDB` so a throttled request buys no database work.
  //
  // FAILS OPEN, and must continue to. This is the degradation path, reached
  // precisely when the internal API or Redis is unavailable, so a limiter that
  // refused on error would convert a partial outage into a total one. Two
  // layers give that: `rateLimit` itself never throws for an unreachable
  // Upstash (it falls back to a per-instance in-memory window and flags the
  // result `degraded`), and the catch below allows the request outright should
  // that contract ever change.
  let rateLimited = false;
  try {
    const rl = await rateLimit(`resolve:${hashIP(clientIP)}`, { limit: 120, windowMs: 60_000 });
    rateLimited = !rl.allowed;
  } catch (error) {
    captureError(error, { route: "fallback-keyword", stage: "rate-limit", domain });
  }
  if (rateLimited) {
    // A page cannot set a 429; `notFound` is the only status primitive this
    // route has, and it is what every other rejection here already returns. No
    // real visitor reaches 120 requests a minute.
    notFound();
  }

  await connectDB();

  if (domain !== PRIMARY_DOMAIN && !(await isDomainServable(domain))) {
    notFound();
  }

  // Read only for a multi-segment path. A root short link is the hot fallback
  // path and must not pay for a configuration lookup it cannot use.
  const pathPrefix = isSingleSegment ? null : (await getDomainConfig(domain))?.pathPrefix;

  const keyword = fallbackKeywordFromSegments(segments, pathPrefix);
  if (!keyword) {
    notFound();
  }

  // Same detachment guard as /api/internal/resolve: this fallback must not be a
  // way round it when the middleware is bypassed.
  const link = await Link.findOne({ domain, keyword, ...LIVE_LINK_FILTER }).lean();
  if (!link) {
    notFound();
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    notFound();
  }

  if (link.isPasswordProtected) {
    redirect(`/password/${keyword}`);
  }

  const userAgent = requestHeaders.get("user-agent") || "";
  const referrer = requestHeaders.get("referer") || "";
  const countryCode = requestHeaders.get("x-vercel-ip-country") || "";

  const ua = UAParser(userAgent);
  const browser = ua.browser.name || "";
  const os = ua.os.name || "";
  const { iv: ipIv, ciphertext: ipRaw } =
    clientIP !== "unknown" ? encryptIP(clientIP) : { iv: "", ciphertext: "" };

  // Fire-and-forget click logging — never block the redirect on it.
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
  ]).catch(() => {});

  redirect(link.url);
}
