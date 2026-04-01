import { customAlphabet } from "nanoid";

const CHARSET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const generate = customAlphabet(CHARSET, 5);

export function generateKeyword(length = 5): string {
  return generate(length);
}

const RESERVED_KEYWORDS = new Set([
  "admin",
  "api",
  "login",
  "logout",
  "assets",
  "preview",
  "password",
  "not-found",
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
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "HMD.bio URL Shortener" },
    });
    const html = await res.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() || "";
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
