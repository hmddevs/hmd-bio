import { customAlphabet } from "nanoid";
import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison, for comparing shared secrets against a
 * request-supplied value without leaking length/content via timing.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const CHARSET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const generate = customAlphabet(CHARSET, 5);

export function generateKeyword(length = 5): string {
  return generate(length);
}

export function numberToBase62(n: number): string {
  if (n === 0) return CHARSET[0];
  let result = "";
  while (n > 0) {
    result = CHARSET[n % 62] + result;
    n = Math.floor(n / 62);
  }
  return result;
}

export function generateKeywordSuggestions(base: string, count = 5): string[] {
  const suggestions: string[] = [];
  for (let i = 1; suggestions.length < count; i++) {
    const candidate = `${base}${i}`;
    if (candidate.length >= 2 && candidate.length <= 100) {
      suggestions.push(candidate);
    }
  }
  // Also add random suffix variants
  while (suggestions.length < count) {
    suggestions.push(`${base}-${generate(3)}`);
  }
  return suggestions;
}

const RESERVED_KEYWORDS = new Set([
  "admin",
  "api",
  "bookmarklet",
  "login",
  "logout",
  "assets",
  "preview",
  "password",
  "not-found",
  "docs",
  "stats",
  "terms",
  "privacy",
  "cookies",
  "aup",
  "signup",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "_next",
]);

export function isReservedKeyword(keyword: string): boolean {
  return RESERVED_KEYWORDS.has(keyword.toLowerCase());
}

const DEFAULT_PROTOCOLS = ["http", "https", "ftp", "ftps", "mailto", "tel", "ssh"];

export function isAllowedProtocol(
  url: string,
  customProtocols: string[] = []
): boolean {
  const allowed = [...DEFAULT_PROTOCOLS, ...customProtocols];
  try {
    const parsed = new URL(url);
    return allowed.includes(parsed.protocol.replace(":", ""));
  } catch {
    return false;
  }
}

/**
 * True if the given IP literal falls in a private, loopback, link-local, or
 * cloud-metadata range. Blocks SSRF against internal services (e.g. Vercel/
 * AWS metadata at 169.254.169.254) when following a user-supplied URL.
 */
function isPrivateOrReservedIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 127 || // loopback
      a === 10 || // private
      a === 0 || // "this" network
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    );
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80:") || // link-local
      lower.startsWith("fc") ||
      lower.startsWith("fd") // unique local
    );
  }
  return true; // unparsable — treat as unsafe
}

/**
 * Resolves the URL's hostname and rejects it if it (or any resolved
 * address) points at a private/loopback/link-local/metadata IP.
 */
async function isSafeExternalUrl(url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (host === "localhost") return false;

  const literalFamily = isIP(host);
  if (literalFamily) {
    return !isPrivateOrReservedIP(host);
  }

  try {
    const addresses = await dnsLookup(host, { all: true, verbatim: true });
    return addresses.every((a) => !isPrivateOrReservedIP(a.address));
  } catch {
    return false; // DNS failure — fail closed
  }
}

export async function fetchPageTitle(url: string): Promise<string> {
  // YouTube oEmbed shortcut
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/
  );
  if (ytMatch) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        return data.title || "";
      }
    } catch {
      // Fall through to generic fetcher
    }
  }

  try {
    let current = url;
    for (let redirects = 0; redirects < 5; redirects++) {
      if (!(await isSafeExternalUrl(current))) return "";

      const res = await fetch(current, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "HMD.bio URL Shortener" },
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return "";
        current = new URL(location, current).toString();
        continue;
      }

      const html = await res.text();
      const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return match?.[1]?.trim() || "";
    }
    return "";
  } catch {
    return "";
  }
}

export async function verifyTurnstile(
  token: string,
  secretKey: string
): Promise<boolean> {
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`,
      }
    );
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
