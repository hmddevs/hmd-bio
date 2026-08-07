/**
 * Deeplink helpers shared by the proxy and the internal routes.
 *
 * Pure module: no database access, no Node-only APIs, safe to import from the
 * edge runtime. Anything here that touches a redirect target treats the target
 * as the only trusted input and the request as hostile.
 */

import { isReservedPathPrefix } from "@/lib/reserved-paths";

/** The three buckets a user-agent is reduced to. Nothing finer is supported. */
export type TargetPlatform = "ios" | "android" | "desktop";

/**
 * The two association paths, matched exactly. Apple and Google both fetch the
 * literal path, so there is deliberately no trailing-slash or case tolerance:
 * anything else stays a 404 rather than becoming a second way to read a
 * tenant's stored file.
 */
export const APP_ASSOCIATION_PATHS: Readonly<Record<string, "aasa" | "assetlinks">> = {
  "/.well-known/apple-app-site-association": "aasa",
  "/.well-known/assetlinks.json": "assetlinks",
};

/** What the proxy needs to know about a hostname beyond "may it serve?". */
export interface DomainConfig {
  mode: "shortener" | "deeplink";
  aasa: string | null;
  assetlinks: string | null;
  fallbackTarget: string | null;
  /**
   * Single path segment, stored without slashes ("l", never "/l/"), or null.
   * Optional on the wire as well as null: a config cached before this field
   * existed must read as "no prefix" rather than as undefined behaviour.
   */
  pathPrefix?: string | null;
}

/**
 * Does this first path segment name the domain's configured prefix?
 *
 * The single decision both entry points below are built on. It exists because
 * the edge (`stripPathPrefix`) and the server-rendered fallback
 * (`fallbackKeywordFromSegments`) previously re-implemented the same question
 * with different string operations and different guards. Drift between them is
 * the worst class of bug this feature can produce: it only shows up while the
 * internal resolve API is down, which is exactly when nobody is in a position
 * to debug it. Sharing the predicate makes agreement structural rather than
 * remembered.
 *
 * Matching is on a whole segment and is case-sensitive, like keywords: `/list`
 * is not a prefixed request under the prefix "l", and neither is `/L/abc`.
 */
export function isPathPrefixSegment(
  segment: string,
  prefix: string | null | undefined
): boolean {
  if (!prefix || typeof prefix !== "string") return false;
  // The stored form is a single slash-free segment. A hand-edited document
  // holding anything else degrades to root-only resolution rather than
  // matching something like "//".
  if (prefix.includes("/")) return false;
  if (!segment) return false;
  if (segment !== prefix) return false;

  // Defence in depth, not the primary guard: the schema already refuses every
  // one of these, so this is only reachable via a prefix written straight into
  // MongoDB. Restated so such a value still cannot take a platform path, an
  // association file, or a matcher-excluded name away from resolution.
  if (segment.startsWith(".")) return false;
  if (isReservedPathPrefix(segment)) return false;

  return true;
}

/**
 * Removes a domain's configured path prefix from a request path.
 *
 * Returns the remaining path, leading slash included, or null when the prefix
 * does not apply. Null is the answer for every request that must keep resolving
 * exactly as it does today: no prefix configured, or a path that does not begin
 * with `/<prefix>/`. The caller then carries on with the original path, so a
 * domain that adds a prefix does not lose the root-level links it already has.
 *
 * Segment matching is delegated to `isPathPrefixSegment`, which the fallback
 * uses as well. `/l` on its own is left alone, so a link whose keyword happens
 * to equal the prefix keeps resolving, and `/l/` is left alone too because it
 * names no keyword at all.
 */
export function stripPathPrefix(
  pathname: string,
  prefix: string | null | undefined
): string | null {
  if (!pathname.startsWith("/")) return null;

  const slash = pathname.indexOf("/", 1);
  // Single segment: cannot be a prefixed request, and must not be treated as
  // one, or a root link named after the prefix would stop resolving.
  if (slash === -1) return null;

  if (!isPathPrefixSegment(pathname.slice(1, slash), prefix)) return null;

  // Always begins with "/", because the separator itself is kept.
  const remainder = pathname.slice(slash);

  // "/l/" carries the prefix but no keyword. Answered as "the prefix does not
  // apply" so that this agrees with `fallbackKeywordFromSegments`, which
  // returns null for the same request; either way the caller falls through to
  // the same 404 the path produces today.
  if (remainder === "/") return null;

  return remainder;
}

/**
 * Which keyword a set of path segments resolves to in the server-rendered
 * fallback, or null when the path is not a short link at all.
 *
 * The fallback route is a catch-all, so it now sees paths that used to have no
 * route and 404 outright. This function is the whole gate deciding which of
 * those may start resolving, and it is deliberately narrow:
 *
 *   1 segment  — today's behaviour, byte for byte. The segment is the keyword,
 *                including one that carries a dot, because that is what the
 *                single dynamic route already handed to the database.
 *   2 segments — only when the domain configures a `pathPrefix` and the first
 *                segment equals it exactly. Everything else stays null, so a
 *                two-segment path on a domain with no prefix keeps 404ing.
 *   otherwise  — null. Deeper paths are the deeplink resolver's business and
 *                are not served by the fallback, exactly as they are not today.
 *
 * The prefix test itself is `isPathPrefixSegment`, the same call
 * `stripPathPrefix` makes, so the edge and the fallback cannot disagree about
 * which keyword a request names.
 */
export function fallbackKeywordFromSegments(
  segments: readonly string[] | undefined,
  pathPrefix: string | null | undefined
): string | null {
  if (!segments || segments.length === 0) return null;

  if (segments.length === 1) {
    return segments[0] || null;
  }

  if (segments.length !== 2) return null;

  const [first, second] = segments;
  // An empty second segment names no keyword, which is the same answer
  // `stripPathPrefix` gives for the trailing-slash form of the same request.
  if (!second) return null;

  if (!isPathPrefixSegment(first, pathPrefix)) return null;

  return second;
}

/**
 * Parses an already-trusted string into a URL, rejecting anything that is not
 * http(s).
 *
 * Every redirect target the platform emits goes through here. Scheme matters
 * more than it looks: `javascript:`, `data:` and app custom schemes stored on a
 * Domain or Link would otherwise be handed straight to `NextResponse.redirect`.
 * Returns null rather than throwing, so a bad stored value degrades to the
 * caller's normal not-found path instead of 500ing the redirect.
 */
export function parseHttpUrl(value: string | null | undefined): URL | null {
  if (!value || typeof value !== "string") return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/**
 * Path segments that must never reach a composed target.
 *
 * `.` and `..` would let the request walk the trusted target's path upwards,
 * and a backslash is treated as a separator by enough clients that it is not
 * safe to pass through. Empty segments are dropped so a forwarded "//host"
 * cannot turn into a protocol-relative authority anywhere downstream.
 *
 * The check runs on the *decoded* segment, which is the part that is easy to
 * get wrong. Assigning to `URL.pathname` percent-decodes and then applies
 * dot-segment removal, so testing the raw text lets "%2e%2e" through and
 * "/app/%2e%2e/%2e%2e/admin" escapes the target's path prefix entirely. A
 * segment that will not decode at all is rejected rather than passed on: it
 * cannot be reasoned about, and no legitimate forwarded path produces one.
 */
function isSafeSegment(segment: string): boolean {
  if (!segment) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }

  if (decoded === "." || decoded === "..") return false;
  if (decoded.includes("/") || decoded.includes("\\")) return false;

  // Both forms: a control character can arrive literally or as "%00".
  for (const value of [segment, decoded]) {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code <= 0x20 || code === 0x7f) return false;
    }
  }
  return true;
}

export interface ForwardParts {
  /** Un-consumed path from the incoming request, leading slash included. */
  extraPath: string;
  /** Incoming query string, leading "?" included, or "". */
  search: string;
}

/**
 * Appends the un-consumed request path and query onto an already-trusted
 * target.
 *
 * The host is fixed by `target` and can never be influenced by the request:
 * only `pathname` and `searchParams` are ever written, and both inputs are
 * filtered first. This is the whole open-redirect story for forwarding, so it
 * must stay the only place composition happens.
 *
 * With both parts empty the original string is returned untouched, byte for
 * byte, which is what every link that has not opted in must keep getting.
 */
export function composeForwardedTarget(target: string, parts: ForwardParts): string {
  const extraPath = parts.extraPath || "";
  const search = parts.search || "";
  if (!extraPath && !search) return target;

  const url = parseHttpUrl(target);
  // Not a URL we are willing to rewrite: hand back the stored value unchanged
  // and let the caller's existing behaviour apply.
  if (!url) return target;

  if (extraPath) {
    const segments = extraPath.split("/").filter(isSafeSegment);
    if (segments.length > 0) {
      const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
      url.pathname = `${base}/${segments.join("/")}`;
    }
  }

  // Appended as a string rather than through `url.searchParams`, which would
  // re-serialise the target's *entire* existing query. That round trip is not
  // byte-preserving (encoding, "+" versus "%20", repeated and valueless keys
  // all change), and it silently invalidates any target carrying a signature
  // over its own query string, which is every OAuth-style or pre-signed URL.
  // The target's own parameters still win on a name collision: a request can
  // never override a value the owner configured.
  const incoming = new URLSearchParams(search);
  const existing = url.searchParams;
  const added: string[] = [];
  for (const [key, value] of incoming) {
    if (existing.has(key)) continue;
    added.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }

  if (added.length > 0) {
    const joined = added.join("&");
    url.search = url.search ? `${url.search}&${joined}` : `?${joined}`;
  }

  return url.toString();
}

/**
 * Reduces a user-agent to one of three buckets.
 *
 * Deliberately coarse. The only question a deeplink answers is "which store or
 * web page should this person land on", and a finer split would create target
 * slots nobody fills.
 */
export function platformFromUA(osName: string | undefined): TargetPlatform {
  const os = (osName || "").toLowerCase();
  if (os === "ios" || os === "ipados" || os === "watchos") return "ios";
  if (os === "android") return "android";
  // Everything unrecognised is desktop on purpose. Guessing a mobile platform
  // from a device hint would send an unknown iOS WebView to the Play Store,
  // whereas desktop falls back to `Link.url`, which always works.
  return "desktop";
}
