import { describe, expect, it } from "vitest";
import {
  ENTRY_TTL_SECONDS,
  buildCacheEntry,
  isCachedLinkExpired,
  linkCacheKey,
  parseCachedLink,
  type CachedLink,
  type ResolvedLink,
} from "../link-cache";

/**
 * Only the pure functions are covered here. `readCachedLink`, `writeCachedLink`,
 * `invalidateCachedLink` and `invalidateCachedLinks` all need a Workers KV
 * binding that is absent under Node, where `getBinding` returns null and every
 * one of them is a no-op: there is no behaviour there for a Node test to
 * observe.
 */

const PRIMARY_DOMAIN = "hmd.bio";

function baseLink(overrides: Partial<ResolvedLink> = {}): ResolvedLink {
  return {
    url: "https://example.com/target",
    ...overrides,
  };
}

describe("linkCacheKey", () => {
  it("builds a versioned key from the domain and keyword", () => {
    expect(linkCacheKey("hmd.bio", "abc123")).toBe("link:v1:hmd.bio:abc123");
  });

  it("returns null once the key would exceed the 512-byte KV limit", () => {
    const longKeyword = "a".repeat(600);
    expect(linkCacheKey("hmd.bio", longKeyword)).toBeNull();
  });

  it("accepts a key that sits exactly at the 512-byte limit", () => {
    // "link:v1:hmd.bio:" is 16 bytes, so 496 more bytes of keyword lands
    // exactly on the boundary and must still be accepted.
    const prefix = "link:v1:hmd.bio:";
    const keyword = "a".repeat(512 - prefix.length);
    const key = linkCacheKey("hmd.bio", keyword);
    expect(key).not.toBeNull();
    expect(new TextEncoder().encode(key as string).length).toBe(512);
  });

  it("counts UTF-8 bytes rather than characters for multi-byte keywords", () => {
    // Each "€" is 3 bytes in UTF-8, so 200 of them alone already exceed 512
    // bytes even though the string is only 200 characters long.
    const keyword = "€".repeat(200);
    expect(linkCacheKey("hmd.bio", keyword)).toBeNull();
  });
});

describe("parseCachedLink", () => {
  const validRaw = JSON.stringify({
    url: "https://example.com/target",
    statusCode: 302,
    isPasswordProtected: false,
    forwardPath: true,
    forwardQuery: false,
    expiresAt: null,
  });

  it("parses a well-formed entry", () => {
    expect(parseCachedLink(validRaw)).toEqual({
      url: "https://example.com/target",
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: true,
      forwardQuery: false,
      expiresAt: null,
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseCachedLink("{not json")).toBeNull();
  });

  it("returns null for a JSON value that is not an object", () => {
    expect(parseCachedLink("42")).toBeNull();
    expect(parseCachedLink('"a string"')).toBeNull();
    expect(parseCachedLink("null")).toBeNull();
  });

  it("returns null when the url field is missing", () => {
    const raw = JSON.stringify({
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: false,
      expiresAt: null,
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("rejects a javascript: url as an open-redirect guard", () => {
    const raw = JSON.stringify({
      url: "javascript:alert(1)",
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: false,
      expiresAt: null,
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("rejects a non-http(s) scheme such as ftp:", () => {
    const raw = JSON.stringify({
      url: "ftp://x",
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: false,
      expiresAt: null,
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("returns null for a statusCode other than 301 or 302", () => {
    const raw = JSON.stringify({
      url: "https://example.com",
      statusCode: 200,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: false,
      expiresAt: null,
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("returns null when isPasswordProtected is not a boolean", () => {
    const raw = JSON.stringify({
      url: "https://example.com",
      statusCode: 302,
      isPasswordProtected: "false",
      forwardPath: false,
      forwardQuery: false,
      expiresAt: null,
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("returns null when forwardPath is not a boolean", () => {
    const raw = JSON.stringify({
      url: "https://example.com",
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: 1,
      forwardQuery: false,
      expiresAt: null,
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("returns null when forwardQuery is not a boolean", () => {
    const raw = JSON.stringify({
      url: "https://example.com",
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: null,
      expiresAt: null,
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("returns null when expiresAt is neither null nor a finite number", () => {
    const raw = JSON.stringify({
      url: "https://example.com",
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: false,
      expiresAt: "tomorrow",
    });
    expect(parseCachedLink(raw)).toBeNull();
  });

  it("accepts a finite numeric expiresAt", () => {
    const raw = JSON.stringify({
      url: "https://example.com",
      statusCode: 301,
      isPasswordProtected: true,
      forwardPath: false,
      forwardQuery: true,
      expiresAt: 1_700_000_000_000,
    });
    expect(parseCachedLink(raw)).toEqual({
      url: "https://example.com",
      statusCode: 301,
      isPasswordProtected: true,
      forwardPath: false,
      forwardQuery: true,
      expiresAt: 1_700_000_000_000,
    });
  });
});

describe("isCachedLinkExpired", () => {
  function entryWithExpiry(expiresAt: number | null): CachedLink {
    return {
      url: "https://example.com",
      statusCode: 302,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: false,
      expiresAt,
    };
  }

  it("is never expired when expiresAt is null", () => {
    expect(isCachedLinkExpired(entryWithExpiry(null), Date.now())).toBe(false);
  });

  it("is expired once now has reached expiresAt", () => {
    expect(isCachedLinkExpired(entryWithExpiry(1_000), 1_000)).toBe(true);
  });

  it("is expired once now has passed expiresAt", () => {
    expect(isCachedLinkExpired(entryWithExpiry(1_000), 1_001)).toBe(true);
  });

  it("is not expired while now is still before expiresAt", () => {
    expect(isCachedLinkExpired(entryWithExpiry(1_000), 999)).toBe(false);
  });
});

describe("buildCacheEntry", () => {
  const now = 1_700_000_000_000;

  it("returns null for a link on a domain other than the primary domain", () => {
    expect(buildCacheEntry("custom.example", PRIMARY_DOMAIN, baseLink(), now)).toBeNull();
  });

  it("returns null for a link with per-platform targets", () => {
    const link = baseLink({ targets: [{ platform: "ios", url: "https://apps.apple.com" }] });
    expect(buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now)).toBeNull();
  });

  it("returns null when the link's url is not http(s)", () => {
    const link = baseLink({ url: "javascript:alert(1)" });
    expect(buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now)).toBeNull();
  });

  it("returns null when the link expires in under 60 seconds, KV's minimum TTL", () => {
    const link = baseLink({ expiresAt: new Date(now + 59_000) });
    expect(buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now)).toBeNull();
  });

  it("caches a plain primary-domain link", () => {
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, baseLink(), now);
    expect(result).not.toBeNull();
    expect(result?.value.url).toBe("https://example.com/target");
  });

  it("caches a link with an empty targets array", () => {
    const link = baseLink({ targets: [] });
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now);
    expect(result).not.toBeNull();
  });

  it("uses ENTRY_TTL_SECONDS for a link with no expiry", () => {
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, baseLink(), now);
    expect(result?.ttlSeconds).toBe(ENTRY_TTL_SECONDS);
  });

  it("caps the TTL to the seconds remaining when the link expires sooner", () => {
    const link = baseLink({ expiresAt: new Date(now + 90_000) });
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now);
    expect(result?.ttlSeconds).toBe(90);
  });

  it("does not cap the TTL when the link outlives ENTRY_TTL_SECONDS", () => {
    // Expressed against the constant rather than a literal, so raising the TTL
    // cannot silently turn this into a test of the capping branch above.
    const link = baseLink({ expiresAt: new Date(now + (ENTRY_TTL_SECONDS + 600) * 1000) });
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now);
    expect(result?.ttlSeconds).toBe(ENTRY_TTL_SECONDS);
  });

  it("defaults statusCode, forwardPath, forwardQuery and isPasswordProtected when absent", () => {
    // Every link in the live database predates these fields. An absent flag
    // must resolve to false, and an absent statusCode to 301, which is what
    // `link.statusCode || 301` in the resolve endpoint already answers: the
    // cached and uncached paths must not disagree about the same document.
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, baseLink(), now);
    expect(result?.value).toEqual({
      url: "https://example.com/target",
      statusCode: 301,
      isPasswordProtected: false,
      forwardPath: false,
      forwardQuery: false,
      expiresAt: null,
    });
  });

  it("preserves an explicit statusCode of 301", () => {
    const link = baseLink({ statusCode: 301 });
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now);
    expect(result?.value.statusCode).toBe(301);
  });

  it("preserves explicit true flags rather than defaulting them away", () => {
    const link = baseLink({ isPasswordProtected: true, forwardPath: true, forwardQuery: true });
    const result = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now);
    expect(result?.value).toMatchObject({
      isPasswordProtected: true,
      forwardPath: true,
      forwardQuery: true,
    });
  });
});

describe("buildCacheEntry and parseCachedLink round trip", () => {
  it("parses back to an equal entry after a JSON round trip", () => {
    const now = 1_700_000_000_000;
    const link = baseLink({
      statusCode: 301,
      isPasswordProtected: true,
      forwardPath: true,
      expiresAt: new Date(now + 120_000),
    });

    const built = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, link, now);
    expect(built).not.toBeNull();

    const parsed = parseCachedLink(JSON.stringify(built?.value));
    expect(parsed).toEqual(built?.value);
  });

  it("round-trips a never-expiring link", () => {
    const now = 1_700_000_000_000;
    const built = buildCacheEntry(PRIMARY_DOMAIN, PRIMARY_DOMAIN, baseLink(), now);
    expect(built).not.toBeNull();

    const parsed = parseCachedLink(JSON.stringify(built?.value));
    expect(parsed).toEqual(built?.value);
  });
});
