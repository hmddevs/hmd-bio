/**
 * Hostname helpers for custom domains.
 *
 * Pure module: no database access, no Node-only APIs, safe to import from
 * middleware and the edge runtime.
 */

/**
 * The platform's own domain. Every link created before custom-domain support
 * is backfilled to this value, so it is a real hostname and never a null
 * sentinel.
 */
export const PRIMARY_DOMAIN: string =
  process.env.NEXT_PUBLIC_PRIMARY_DOMAIN?.trim().toLowerCase() || "hmd.bio";

/**
 * Reduce a Host header (or user-supplied hostname) to a canonical form:
 * lowercase, no port, no trailing dot, no leading "www.".
 *
 * Total function: never throws, and returns "" for input that cannot be
 * reduced to a plausible hostname. Callers must treat "" as invalid.
 */
export function normaliseHost(host: string): string {
  if (typeof host !== "string") return "";

  let value = host.trim().toLowerCase();
  if (!value) return "";

  // Strip a scheme and anything after the authority, so a pasted URL still
  // reduces to its hostname rather than being rejected outright.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0] ?? "";
  value = value.split("?")[0] ?? "";
  value = value.split("#")[0] ?? "";

  // Drop any userinfo prefix ("user:pass@host").
  const atIndex = value.lastIndexOf("@");
  if (atIndex !== -1) value = value.slice(atIndex + 1);

  if (!value) return "";

  // Bracketed IPv6 literal: keep the literal, drop the port.
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close === -1) return "";
    value = value.slice(0, close + 1);
  } else {
    // Strip a trailing ":port". A bare colon with no digits is junk.
    const colon = value.lastIndexOf(":");
    if (colon !== -1) {
      const port = value.slice(colon + 1);
      if (!/^\d*$/.test(port)) return "";
      value = value.slice(0, colon);
    }
  }

  // Strip the trailing dot of a fully-qualified name.
  while (value.endsWith(".")) value = value.slice(0, -1);

  if (value.startsWith("www.")) value = value.slice(4);

  value = value.trim();
  if (!value) return "";

  // Anything with whitespace or a control character left in it is not a host.
  // Hyphens and dots are legitimate, so they are deliberately not rejected.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return "";
  }

  return value;
}


/** True when the given host is the platform's own domain. */
export function isPrimaryHost(host: string): boolean {
  const normalised = normaliseHost(host);
  return normalised !== "" && normalised === PRIMARY_DOMAIN;
}

/**
 * Hosts the platform itself is served on, which must behave exactly like the
 * primary domain rather than being treated as a tenant's custom domain.
 *
 * This covers local development (localhost, 127.0.0.1, *.local) and Vercel
 * preview deployments (*.vercel.app). Without it, `pnpm dev` and every preview
 * build would classify their own host as a custom domain and redirect the
 * dashboard away to production.
 */
export function isPlatformHost(host: string): boolean {
  const normalised = normaliseHost(host);
  if (!normalised) return true;
  if (normalised === PRIMARY_DOMAIN) return true;
  if (normalised === "localhost" || normalised === "127.0.0.1" || normalised === "::1") {
    return true;
  }
  if (normalised.endsWith(".localhost") || normalised.endsWith(".local")) return true;
  if (normalised === "vercel.app" || normalised.endsWith(".vercel.app")) return true;
  return false;
}

/**
 * The `domain` value a request should be scoped to, derived from its Host
 * header. Any platform host (primary, localhost, a preview deployment) maps to
 * PRIMARY_DOMAIN so that development and previews resolve the same links
 * production does; anything else is the tenant's own hostname.
 *
 * This is the single chokepoint for host-to-domain mapping. Every request path
 * that reads a Link from a Host header must go through it, so the mapping rules
 * cannot drift between the middleware, the server-rendered fallback, and the
 * public API.
 */
export function domainFromHost(host: string | null | undefined): string {
  const normalised = normaliseHost(host ?? "");
  if (!normalised || isPlatformHost(normalised)) return PRIMARY_DOMAIN;
  return normalised;
}

/**
 * The canonical public URL for a link, built from the link's own domain.
 *
 * Never build a short URL by concatenating a base URL with a keyword: a link on
 * a custom domain has a different origin from the request that created it.
 *
 * On the primary domain, AUTH_URL is honoured when present so that local and
 * preview environments keep producing URLs that actually work there. A custom
 * domain is always https, because Vercel issues and renews the certificate
 * before the domain ever reaches `active`.
 */
export function buildShortUrl(domain: string | null | undefined, keyword: string): string {
  const host = normaliseHost(domain ?? "") || PRIMARY_DOMAIN;

  if (host === PRIMARY_DOMAIN) {
    const base = process.env.AUTH_URL?.trim().replace(/\/+$/, "");
    if (base) return `${base}/${keyword}`;
  }

  return `https://${host}/${keyword}`;
}

/**
 * Hostnames a user must never be able to attach.
 *
 * This is a floor, not a ceiling: it stops the obvious impersonation attempts
 * (banks, payment providers, household-name brands) and is expected to grow.
 * It is not a substitute for ownership verification, which is what actually
 * makes attaching a domain safe. Add entries freely; keep them registrable
 * apex names, since subdomains are covered by the suffix check below.
 */
export const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  // Payments
  "paypal.com",
  "stripe.com",
  "wise.com",
  "revolut.com",
  "venmo.com",
  "coinbase.com",
  "binance.com",
  // Banks
  "hsbc.com",
  "barclays.co.uk",
  "lloydsbank.com",
  "natwest.com",
  "santander.co.uk",
  "chase.com",
  "citibank.com",
  "garantibbva.com.tr",
  "isbank.com.tr",
  // Major brands and identity providers
  "google.com",
  "apple.com",
  "microsoft.com",
  "amazon.com",
  "meta.com",
  "facebook.com",
  "instagram.com",
  "whatsapp.com",
  "x.com",
  "github.com",
  "netflix.com",
  "cloudflare.com",
  "vercel.com",
]);

/**
 * True when the hostname is blocked: an exact blocklist match, a subdomain of
 * a blocked entry, or anything on the platform's own domain (which we own and
 * must never hand to a tenant).
 */
export function isBlockedHostname(host: string): boolean {
  const normalised = normaliseHost(host);
  if (!normalised) return true;

  if (normalised === PRIMARY_DOMAIN || normalised.endsWith(`.${PRIMARY_DOMAIN}`)) {
    return true;
  }
  if (normalised === "hmd.bio" || normalised.endsWith(".hmd.bio")) {
    return true;
  }

  for (const blocked of BLOCKED_HOSTNAMES) {
    if (normalised === blocked || normalised.endsWith(`.${blocked}`)) return true;
  }

  return false;
}

/**
 * Multi-label public suffixes that must never be claimable on their own, and
 * which apex detection has to know about.
 *
 * This is a deliberately short hardcoded list of the common ones rather than a
 * full Public Suffix List dependency: it matches the existing blocklist
 * approach, and the real guard on claiming is still DNS TXT verification, which
 * nobody can pass for a suffix they do not control.
 */
export const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk", "org.uk", "me.uk", "gov.uk", "ac.uk", "net.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "com.br", "net.br", "org.br", "gov.br",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  "co.za", "org.za", "net.za", "gov.za", "ac.za",
  "com.tr", "net.tr", "org.tr", "gov.tr", "edu.tr", "web.tr",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "co.in", "net.in", "org.in", "gov.in", "ac.in",
  "com.mx", "com.ar", "com.sg", "com.hk", "com.tw", "co.kr", "co.il", "co.id",
  "com.pl", "com.ua", "com.ru", "co.th", "com.my", "com.ph", "com.vn",
]);

/**
 * How many trailing labels make up the public suffix of a hostname: two for a
 * known multi-label suffix such as `com.tr`, one otherwise.
 */
function publicSuffixLabelCount(labels: readonly string[]): number {
  if (labels.length >= 2 && PUBLIC_SUFFIXES.has(labels.slice(-2).join("."))) {
    return 2;
  }
  return 1;
}

/**
 * True when the hostname is a registrable domain with nothing in front of it.
 *
 * Counting labels is not enough: `guden.com.tr` has three labels but is an apex,
 * because `com.tr` is a public suffix. The rule is that a hostname is an apex
 * when it has exactly one label above its public suffix.
 *
 * Returns false for anything that is not a plausible hostname, and for a bare
 * public suffix, neither of which has a meaningful pointing record.
 */
export function isApexDomain(hostname: string): boolean {
  const normalised = normaliseHost(hostname);
  if (!normalised || !normalised.includes(".")) return false;

  const labels = normalised.split(".");
  if (labels.some((label) => label === "")) return false;

  return labels.length === publicSuffixLabelCount(labels) + 1;
}

/**
 * Where a custom domain must point for Vercel to serve it. Both are read from
 * the environment first, so they can be corrected without a code change if
 * Vercel ever moves them.
 */
export const VERCEL_APEX_IP: string = process.env.VERCEL_APEX_IP?.trim() || "76.76.21.21";

export const VERCEL_CNAME_TARGET: string =
  process.env.VERCEL_CNAME_TARGET?.trim() || "cname.vercel-dns.com";

export interface PointingRecord {
  recordType: "A" | "CNAME";
  name: string;
  value: string;
}

/**
 * The DNS record that makes a hostname actually serve traffic, as opposed to
 * the TXT record that only proves ownership.
 *
 * An apex gets an A record, because a CNAME at the apex is invalid DNS and
 * would break the domain's other records. A subdomain gets a CNAME.
 *
 * `name` is the exact label to type into a DNS provider's form. Most providers
 * use "@" to mean the domain itself, so that is what an apex returns; a few ask
 * for the full hostname instead, in which case the user should enter the whole
 * domain. A subdomain returns only the labels in front of the registrable
 * domain, for example "go" for "go.acme.com".
 */
export function vercelPointingRecord(hostname: string): PointingRecord {
  const normalised = normaliseHost(hostname);

  if (isApexDomain(normalised)) {
    return { recordType: "A", name: "@", value: VERCEL_APEX_IP };
  }

  const labels = normalised.split(".");
  const suffixCount = publicSuffixLabelCount(labels);
  const prefix = labels.slice(0, Math.max(labels.length - suffixCount - 1, 0));

  return {
    recordType: "CNAME",
    name: prefix.length > 0 ? prefix.join(".") : normalised,
    value: VERCEL_CNAME_TARGET,
  };
}
