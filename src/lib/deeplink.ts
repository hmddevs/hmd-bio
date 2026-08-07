/**
 * Deeplink helpers shared by the proxy and the internal routes.
 *
 * Pure module: no database access, no Node-only APIs, safe to import from the
 * edge runtime. Anything here that touches a redirect target treats the target
 * as the only trusted input and the request as hostile.
 */

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
