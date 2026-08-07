import { NextRequest, NextResponse } from "next/server";
import { PRIMARY_DOMAIN, domainFromHost, isPlatformHost, normaliseHost } from "@/lib/domains";

/**
 * Paths that belong to the application shell rather than to short-link
 * resolution. On a platform host these are handed straight to Next; on a custom
 * domain they are redirected to the primary domain instead (see below).
 */
const BYPASS_PREFIXES = [
  "/admin",
  "/api",
  "/bookmarklet",
  "/dashboard",
  "/docs",
  "/login",
  "/signup",
  "/preview",
  "/password",
  "/not-found",
  "/stats",
  "/terms",
  "/privacy",
  "/cookies",
  "/aup",
];

/**
 * The only application paths a custom domain serves. Everything a short link
 * can legitimately land on:
 *
 *   /password  — the unlock page for a protected link
 *   /stats     — the public preview rendered for the "keyword+" suffix
 *   /not-found — the rewrite target for a missing or expired link
 */
const CUSTOM_DOMAIN_ALLOWED_PREFIXES = ["/password", "/stats", "/not-found"];

/**
 * The only API paths a custom domain serves, matched exactly rather than by
 * prefix.
 *
 * These three exist because a custom host genuinely cannot do without them:
 * the password page and the stats preview are client components fetching
 * same-origin (redirecting them to the primary domain would make the calls
 * cross-origin and drop the session cookie), and this middleware calls
 * /api/internal/resolve on the incoming request's own origin.
 *
 * The rest of the `/api` tree is redirected to the primary domain like any
 * other app route. Serving the whole tree on every tenant hostname widened the
 * reachable surface for no benefit: nothing else under `/api` is fetched by a
 * page a custom domain renders.
 */
const CUSTOM_DOMAIN_ALLOWED_API = [
  /^\/api\/v1\/links\/[^/]+\/unlock$/,
  /^\/api\/v1\/stats\/[^/]+$/,
  /^\/api\/internal\/resolve$/,
];

/**
 * Segment-aware prefix test. A plain `startsWith` matches "/apiary" against
 * "/api", which would treat keywords like `apiary`, `statsboard` and
 * `passwordless` as app paths and stop them ever resolving.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function redirectToPrimary(request: NextRequest): NextResponse {
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${PRIMARY_DOMAIN}`);
  // 308 rather than 307: the app shell is permanently at the primary domain,
  // and 308 preserves the method for any non-GET that lands here.
  return NextResponse.redirect(target, 308);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Prefer x-forwarded-host: behind Vercel's proxy the Host header can be the
  // internal deployment host, while x-forwarded-host carries what the visitor
  // actually typed.
  const rawHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const host = normaliseHost(rawHost);

  // Localhost and *.vercel.app are the platform's own hosts and behave exactly
  // like the primary domain, so development and preview deployments are not
  // mistaken for a tenant's custom domain.
  const onCustomDomain = !isPlatformHost(host);

  // The domain every Link read on this request must be scoped to.
  const domain = domainFromHost(host);

  if (onCustomDomain) {
    // A custom domain serves short links and nothing else. Anything belonging
    // to the app shell goes to the primary domain rather than rendering here,
    // so a tenant's host can never show the dashboard, admin, auth, or legal
    // pages.
    const allowed =
      CUSTOM_DOMAIN_ALLOWED_PREFIXES.some((p) => matchesPrefix(pathname, p)) ||
      CUSTOM_DOMAIN_ALLOWED_API.some((p) => p.test(pathname));
    if (!allowed && (pathname === "/" || BYPASS_PREFIXES.some((p) => matchesPrefix(pathname, p)))) {
      return redirectToPrimary(request);
    }
    if (allowed) {
      return NextResponse.next();
    }
    // Anything else on a custom host falls through to short-link resolution.
  } else {
    // Platform host: unchanged behaviour. Skip non-shorturl paths.
    if (BYPASS_PREFIXES.some((p) => matchesPrefix(pathname, p)) || pathname === "/") {
      return NextResponse.next();
    }
  }

  // Check for preview suffix (keyword+)
  const isPreview = pathname.endsWith("+");
  const keyword = isPreview
    ? pathname.slice(1, -1)
    : pathname.slice(1);

  // Skip if keyword is empty or looks like a file
  if (!keyword || keyword.includes(".") || keyword.includes("/")) {
    return NextResponse.next();
  }

  // Stats pages (keyword+) — rewrite directly (no click logged). The rewritten
  // page reads the host itself, so it stays scoped to this domain.
  if (isPreview) {
    const statsUrl = new URL(`/stats/${keyword}`, request.url);
    return NextResponse.rewrite(statsUrl);
  }

  // Collect request metadata for click logging
  const ip = request.headers.get("x-forwarded-for") || "";
  const userAgent = request.headers.get("user-agent") || "";
  const referrer = request.headers.get("referer") || "";
  const countryCode = request.headers.get("x-vercel-ip-country") || "";

  // ── Resolve via internal API (MongoDB) ──
  const resolveUrl = new URL("/api/internal/resolve", request.url);
  resolveUrl.searchParams.set("keyword", keyword);
  resolveUrl.searchParams.set("domain", domain);

  const headers: Record<string, string> = {
    "x-forwarded-for": ip,
    "user-agent": userAgent,
    referer: referrer,
    "x-geo-country": countryCode,
    "x-internal-secret": process.env.INTERNAL_SECRET || "",
  };

  let genuineNotFound = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(resolveUrl.toString(), { headers });

      if (res.status === 404 || res.status === 410) {
        // Genuinely missing / expired — stop retrying
        genuineNotFound = true;
        break;
      }

      if (!res.ok) {
        // Transient server error — retry once
        continue;
      }

      const data = await res.json();

      if (data.isPasswordProtected) {
        const passwordUrl = new URL(`/password/${keyword}`, request.url);
        return NextResponse.rewrite(passwordUrl);
      }

      return NextResponse.redirect(data.url, data.statusCode || 302);
    } catch {
      // Network / timeout — retry once
      continue;
    }
  }

  if (genuineNotFound) {
    // Link confirmed missing / expired — show not-found
    const notFoundUrl = new URL("/not-found", request.url);
    const notFoundRes = NextResponse.rewrite(notFoundUrl);
    notFoundRes.headers.set("Cache-Control", "private, no-cache, no-store");
    return notFoundRes;
  }

  // Resolve API unreachable (cold start, timeout, etc.) — fall through to
  // the server-side [keyword] catch-all page which connects to MongoDB directly
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Matches everything except Next's own internals and static assets.
     *
     * This is deliberately wider than the old matcher, which excluded /admin,
     * /dashboard, /login, the legal pages and so on by negative lookahead.
     * Those paths therefore never reached the middleware at all, which means
     * the host check could not run on them and a custom domain would happily
     * render the dashboard. The exclusion now lives inside the proxy
     * (BYPASS_PREFIXES), after the host has been inspected: platform hosts get
     * the same NextResponse.next() as before, custom hosts get a redirect to
     * the primary domain.
     *
     * Cost of the wider matcher: the middleware now runs on app-shell requests
     * that previously skipped it. The added work is two header reads and a
     * prefix scan, with no I/O, so there is no meaningful latency change.
     *
     * /api is matched too, and returns early for both host kinds, so the
     * middleware's own call to /api/internal/resolve cannot recurse.
     */
    "/((?!_next|assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|icon|apple-icon|opengraph-image).*)",
  ],
};
