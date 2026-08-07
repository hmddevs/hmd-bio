/**
 * The path segments the platform owns, in one place.
 *
 * `BYPASS_PREFIXES` lives here rather than in src/proxy.ts because two very
 * different callers need the same list and must never drift apart: the proxy
 * decides what is app shell rather than a short link, and the domain
 * configuration schema refuses a `pathPrefix` that would sit on top of one. A
 * prefix that shadowed "/stats" would take the public preview page away from
 * the tenant's own visitors, and one on "/api" would take the endpoints the
 * password and stats pages fetch.
 *
 * Pure data, no imports: safe from the edge runtime and from a Zod schema
 * alike.
 */

/**
 * Paths that belong to the application shell rather than to short-link
 * resolution. On a platform host these are handed straight to Next; on a custom
 * domain they are redirected to the primary domain instead.
 */
export const BYPASS_PREFIXES = [
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
 * The names the middleware matcher excludes outright, in matcher order.
 *
 * Different failure mode from a bypass prefix, and worth rejecting for the
 * opposite reason: the middleware never runs on these at all, so a prefix here
 * would not be shadowed by the app shell, it would simply never resolve
 * anything and the customer would see a silent 404 with nothing to diagnose.
 *
 * This list is the single source for both the matcher regex in src/proxy.ts
 * (built by `buildMatcherPattern` below) and the prefix rejection above it, so
 * adding an exclusion in one place cannot leave the other behind.
 */
export const MATCHER_EXCLUDED_NAMES = [
  "_next",
  "assets",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "manifest.webmanifest",
  "icon",
  "apple-icon",
  "opengraph-image",
];

/** Escapes a literal so it means only itself inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The middleware matcher pattern, built from `MATCHER_EXCLUDED_NAMES`.
 *
 * Not consumed by src/proxy.ts, which cannot use it: Turbopack parses the
 * exported `config.matcher` statically and rejects any value it cannot read at
 * compile time, so that field has to stay a string literal. This is the oracle
 * for it instead. A test asserts the literal and this output are byte
 * identical, which is what stops the regex and the `pathPrefix` validation
 * drifting apart again.
 *
 * The shape it reproduces is a negative lookahead at position 1 followed by
 * `.*`. That lookahead is a RAW STRING PREFIX TEST, not a segment test:
 * "/icons/abc" begins with "icon" and therefore skips the middleware entirely,
 * which is precisely why `isReservedPathPrefix` matches these names by prefix.
 */
export function buildMatcherPattern(): string {
  return `/((?!${MATCHER_EXCLUDED_NAMES.map(escapeRegExp).join("|")}).*)`;
}

/**
 * Every first path segment a domain's `pathPrefix` may not take, lower-cased,
 * matched exactly.
 *
 * Derived from `BYPASS_PREFIXES` rather than restated, plus the two the proxy
 * handles outside it: "well-known", because the association files are served
 * before any prefix handling and a prefix there could only ever be dead, and
 * "api", which is already a bypass prefix but is named explicitly so removing
 * it from that list cannot quietly free it.
 *
 * The matcher exclusions are deliberately NOT in here: they need prefix
 * matching, not exact matching, which is what `isReservedPathPrefix` adds.
 */
export const RESERVED_PATH_PREFIXES: ReadonlySet<string> = new Set([
  ...BYPASS_PREFIXES.map((prefix) => prefix.replace(/^\//, "").toLowerCase()),
  "well-known",
  "api",
]);

/**
 * Whether a value begins with a name the middleware matcher excludes.
 *
 * Exported in its own right because two different inputs need exactly this
 * half of `isReservedPathPrefix` and nothing else: a domain's `pathPrefix`, and
 * a link keyword. A keyword such as "iconoclast" or "_nextx" is accepted by the
 * keyword regex but skips the middleware entirely, so it never reaches
 * /api/internal/resolve or its 120/min limit and lands on the outage-only
 * fallback page instead, which writes a Click and increments the link on every
 * hit. Writing the `startsWith` test a second time at the keyword call site is
 * the duplication that caused the original drift, so there is one copy.
 *
 * Matching is case-insensitive here even though the matcher regex is not:
 * over-rejecting a keyword is cheap, and the mixed-case variants are not worth
 * reasoning about per caller.
 */
export function startsWithMatcherExcludedName(value: string): boolean {
  const candidate = value.toLowerCase();
  return MATCHER_EXCLUDED_NAMES.some((name) => candidate.startsWith(name));
}

/**
 * Whether a candidate `pathPrefix` collides with something the platform owns.
 *
 * Two different tests, because the two lists have two different semantics and
 * conflating them is how a tenant ends up with a prefix that silently bypasses
 * the middleware:
 *
 *   - `BYPASS_PREFIXES` are matched by whole segment in the proxy
 *     (`matchesPrefix`), so "statsboard" is a perfectly good keyword and only
 *     "stats" itself collides. Exact match.
 *   - `MATCHER_EXCLUDED_NAMES` are matched by the matcher's negative lookahead,
 *     which tests the raw string at position 1 with no segment boundary. A
 *     prefix of "icons", "assetsx", "_nextgen", "apple-iconic" or
 *     "opengraph-images" would therefore never reach the middleware at all:
 *     every request under it would skip the resolve endpoint and its rate
 *     limit, and land on the outage-only fallback page, which writes to Mongo
 *     per request and knows nothing about deeplinks, forwarding, the preview
 *     suffix, or per-link status codes. String prefix match, mirroring the
 *     regex exactly.
 */
export function isReservedPathPrefix(value: string): boolean {
  const candidate = value.toLowerCase();
  if (RESERVED_PATH_PREFIXES.has(candidate)) return true;
  return startsWithMatcherExcludedName(candidate);
}
