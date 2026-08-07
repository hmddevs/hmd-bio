import { NextRequest, NextResponse } from "next/server";
import { PRIMARY_DOMAIN, domainFromHost, isPlatformHost, normaliseHost } from "@/lib/domains";
import {
  APP_ASSOCIATION_PATHS,
  composeForwardedTarget,
  parseHttpUrl,
  stripPathPrefix,
  type DomainConfig,
} from "@/lib/deeplink";
// Shared with the domain configuration schema, which refuses a `pathPrefix`
// that would shadow one of these. Defined in its own module so the two cannot
// drift; see src/lib/reserved-paths.ts.
import { BYPASS_PREFIXES } from "@/lib/reserved-paths";

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
  /^\/api\/internal\/domain-config$/,
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

/**
 * The origin every INTERNAL_SECRET-bearing fetch must be addressed to.
 *
 * Never derived from the request, on any host. On a custom domain the request's
 * host is the *tenant's* hostname, resolved by DNS the tenant controls: point
 * the A record at your own server, replay the request to Vercel with
 * `Host: tenant.example`, and the edge hands `x-internal-secret` straight to
 * you. Gating that on `isPlatformHost` is not enough, because it is decided from
 * the `x-forwarded-host`/`Host` header and returns true for an empty host and
 * for every `*.vercel.app` name, a namespace Vercel allocates first-come to any
 * customer. The origin is therefore chosen from a fixed allowlist only.
 *
 * It must also be an origin that answers. This project has Vercel
 * Authentication enabled for `all_except_custom_domains`, so every
 * `*.vercel.app` deployment URL, including the one in VERCEL_URL, answers a
 * bare request with a 302 to the SSO login. `fetch` follows that redirect and
 * returns the login page with `ok === true`, so an addressed-to-VERCEL_URL call
 * does not throw: it succeeds, hands back HTML, and fails only when the caller
 * tries to parse it as JSON. Every internal call then degrades to "no config",
 * which is indistinguishable from "this domain is an ordinary shortener". That
 * is why deeplink serving appeared to work in review and 404s in production.
 *
 * The primary domain is therefore preferred over VERCEL_URL, not the other way
 * round: it is a custom domain, so it is exactly what the protection rule
 * exempts, and it is a build-time constant rather than anything a request can
 * influence.
 *
 *   1. A localhost origin outside production, because `pnpm dev` must never
 *      send its internal calls to the live site. A dev server on a non-default
 *      port needs PORT set for this to resolve.
 *   2. The primary domain, which is a build-time constant and SSO-exempt.
 *
 * Preview deployments are a known gap. Their own origin is protected and the
 * primary domain would run production code, so `loadDomainConfig` returns null
 * there and a preview behaves as a shortener. Closing that needs the
 * deployment's protection-bypass secret sent as a header on the internal fetch,
 * which is a wider change than this fix and is not required for production.
 */
function internalOrigin(): string {
  if (process.env.NODE_ENV !== "production") {
    return `http://127.0.0.1:${process.env.PORT?.trim() || "3000"}`;
  }

  return `https://${PRIMARY_DOMAIN}`;
}

/**
 * Reads a custom domain's deeplink configuration over the internal API.
 *
 * The proxy runs at the edge and cannot import Mongoose, so this mirrors the
 * existing /api/internal/resolve call: platform-trusted origin, same
 * INTERNAL_SECRET header. Any failure returns null, which means "behave exactly
 * as a shortener domain does", so a cold start or a cache outage can never turn
 * into a broken redirect.
 */
async function fetchDomainConfig(
  origin: string,
  domain: string
): Promise<DomainConfig | null> {
  const url = new URL("/api/internal/domain-config", origin);
  url.searchParams.set("domain", domain);

  try {
    const res = await fetch(url.toString(), {
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
      // Never follow a redirect. The internal API answers directly or not at
      // all, so a 3xx here means the origin is wrong, and following it is how
      // a misconfigured origin turns into a silent "no config": Vercel's SSO
      // gate answers 302, fetch follows it to a 200 login page, and only the
      // JSON parse fails. Left manual, that same case is a plain !res.ok.
      redirect: "manual",
    });
    if (!res.ok) return null;
    return (await res.json()) as DomainConfig;
  } catch {
    return null;
  }
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

  // Origin for every internal call made below. Derived from the platform, not
  // from the request: see internalOrigin.
  const internalBase = internalOrigin();

  // Deeplink configuration for this hostname, fetched at most once per request
  // and only by the branches below that genuinely need it. An ordinary
  // single-segment short link never reaches any of them, so the hot redirect
  // path costs exactly what it did before.
  //
  // Multi-segment and .well-known requests do pay a lookup even on a
  // shortener-mode domain, because the mode is only known once the config has
  // been read. Both are paths that 404 today, and the answer is cached per
  // hostname for 60s (in Redis, or in the process-local negative memo when
  // Redis is down), so the cost is bounded rather than per-request.
  let configPromise: Promise<DomainConfig | null> | undefined;
  const loadDomainConfig = (): Promise<DomainConfig | null> => {
    configPromise ??= fetchDomainConfig(internalBase, domain);
    return configPromise;
  };

  // ── Association files (Universal Links / App Links) ──
  //
  // This runs before everything else because both paths would otherwise be
  // killed further down: they contain a "." and a "/", which the keyword skip
  // treats as "not a short link" and hands to Next, where they 404.
  //
  // Only ever on a custom host, only ever on a domain in `deeplink` mode, and
  // only when the file is actually stored. A missing file falls through to
  // today's 404 rather than being served as an empty body, because Apple's CDN
  // caches whatever it first receives and an empty file un-verifies the app.
  const associationFile = onCustomDomain ? APP_ASSOCIATION_PATHS[pathname] : undefined;
  if (associationFile) {
    const config = await loadDomainConfig();
    if (config?.mode === "deeplink") {
      const body = associationFile === "aasa" ? config.aasa : config.assetlinks;
      if (body) {
        // Served verbatim: the stored string is never parsed and re-stringified,
        // since that reorders keys and Apple caches the first bytes it sees.
        return new NextResponse(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            // The body is bytes a customer uploaded. Without nosniff a browser
            // is free to ignore the declared type and sniff it as HTML, which
            // turns a stored association file into stored XSS on the tenant's
            // own origin.
            "x-content-type-options": "nosniff",
            // Matched to the 60s config TTL rather than set higher. A suspended
            // tenant that keeps serving its association files is the failure
            // that matters here, and a cache outliving the TTL is exactly how
            // that happens.
            "cache-control": "public, max-age=60",
          },
        });
      }
    }
  }

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

  // ── Per-domain path prefix ──
  //
  // A domain may serve its links under one extra segment, so that a customer
  // whose codes are already in circulation at /l/<code> can migrate without
  // breaking them. Strictly additive: with no prefix configured, and on any
  // path that does not begin with `/<prefix>/`, `resolvePath` stays the
  // request's own path and everything below behaves exactly as before. A
  // prefixed domain therefore keeps resolving its root-level links too.
  //
  // Runs after the association-file branch on purpose. Those are absolute paths
  // that Apple and Google fetch by name, and they must never be shadowed by a
  // prefix; the schema also refuses "well-known" for the same reason.
  //
  // Only consulted when the path has a second segment, since a single-segment
  // request cannot be prefixed and must not pay for a config lookup: that is
  // the hot redirect path.
  let resolvePath = pathname;
  if (onCustomDomain && pathname.indexOf("/", 1) !== -1) {
    const config = await loadDomainConfig();
    const stripped = stripPathPrefix(pathname, config?.pathPrefix);
    if (stripped !== null) resolvePath = stripped;
  }

  // Check for preview suffix (keyword+)
  const isPreview = resolvePath.endsWith("+");
  let keyword = isPreview
    ? resolvePath.slice(1, -1)
    : resolvePath.slice(1);

  // Path left over after the keyword, forwarded onto the target only when the
  // link opts in. Empty for every request that is not a deeplink lookup.
  let extraPath = "";

  // A deeplink domain resolves on the FIRST path segment and keeps the rest,
  // so /publicMatchDetailScreen/42 matches the keyword `publicMatchDetailScreen`.
  // Gated on the mode because on a shortener domain a multi-segment path must
  // keep falling through to Next untouched: without the gate every existing
  // multi-segment 404 would start hitting the resolve endpoint.
  if (!isPreview && onCustomDomain && keyword.includes("/")) {
    const config = await loadDomainConfig();
    if (config?.mode === "deeplink") {
      const slash = keyword.indexOf("/");
      extraPath = keyword.slice(slash);
      keyword = keyword.slice(0, slash);
    }
  }

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
  const resolveUrl = new URL("/api/internal/resolve", internalBase);
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

      // Compose only what the link opted into. With both flags false (the
      // model default, and therefore every link that exists today) this returns
      // data.url unchanged, byte for byte. The host always comes from the
      // resolved target and can never be influenced by the request. The path is
      // a different matter: assigning to `URL.pathname` percent-decodes and
      // applies dot-segment removal, so a segment is only additive once it has
      // survived the decoded `.`/`..` check in composeForwardedTarget. Without
      // that check `%2e%2e` walks straight out of the target's path prefix.
      const target = composeForwardedTarget(data.url, {
        extraPath: data.forwardPath === true ? extraPath : "",
        search: data.forwardQuery === true ? request.nextUrl.search : "",
      });

      return NextResponse.redirect(target, data.statusCode || 302);
    } catch {
      // Network / timeout — retry once
      continue;
    }
  }

  if (genuineNotFound) {
    // Catch-all: on a deeplink domain an unmatched keyword belongs to the app's
    // marketing site, not to a 404 page. Validated as http(s) at the point of
    // use rather than trusted from the database, so a malformed or non-http
    // stored value degrades to the not-found rewrite instead of becoming an
    // open redirect. Nothing from the request is composed onto it.
    if (onCustomDomain) {
      const config = await loadDomainConfig();
      const fallback = config?.mode === "deeplink" ? parseHttpUrl(config.fallbackTarget) : null;
      if (fallback) {
        const fallbackRes = NextResponse.redirect(fallback.toString(), 302);
        fallbackRes.headers.set("Cache-Control", "private, no-cache, no-store");
        return fallbackRes;
      }
    }

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
     *
     * Must stay a literal: Turbopack parses this field statically and rejects
     * anything it cannot read at compile time, including a function call. The
     * names in it are therefore mirrored by MATCHER_EXCLUDED_NAMES, and
     * `buildMatcherPattern()` reproduces this exact string; a test asserts the
     * two are byte-identical, so the list and the regex cannot drift.
     *
     * They diverged once already: the `pathPrefix` validation matched these
     * names by whole segment, while this lookahead is a RAW PREFIX TEST at
     * position 1. That let a tenant configure "icons" and take every request
     * under it out of the middleware, past the resolve endpoint and its rate
     * limit, onto the outage-only fallback page.
     */
    "/((?!_next|assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|icon|apple-icon|opengraph-image).*)",
  ],
};
