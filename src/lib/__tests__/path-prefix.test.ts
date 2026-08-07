import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  APP_ASSOCIATION_PATHS,
  fallbackKeywordFromSegments,
  stripPathPrefix,
} from "../deeplink";
import { deeplinkConfigSchema, editLinkSchema, shortenSchema } from "../validations";
import {
  BYPASS_PREFIXES,
  MATCHER_EXCLUDED_NAMES,
  buildMatcherPattern,
  isReservedPathPrefix,
  startsWithMatcherExcludedName,
} from "../reserved-paths";

/**
 * The behaviour under test is "which keyword does this request resolve, and
 * what is left over to forward", so every case below is written as a path in
 * and a path out. Null means "the prefix does not apply", which is the answer
 * that keeps today's resolution untouched.
 */
describe("stripPathPrefix", () => {
  it("strips a matching prefix and leaves the keyword path", () => {
    expect(stripPathPrefix("/l/abc123", "l")).toBe("/abc123");
  });

  it("keeps the remainder intact for path forwarding", () => {
    expect(stripPathPrefix("/l/abc123/deep/path", "l")).toBe("/abc123/deep/path");
  });

  it("composes to the same remainder an unprefixed request would produce", () => {
    // The invariant behind requirement 3: /l/<code>/deep/path must reach the
    // resolver looking exactly like /<code>/deep/path already does.
    expect(stripPathPrefix("/l/abc123/deep/path", "l")).toBe("/abc123/deep/path");
  });

  it("does not apply when no prefix is configured", () => {
    expect(stripPathPrefix("/l/abc123", null)).toBeNull();
    expect(stripPathPrefix("/l/abc123", undefined)).toBeNull();
    expect(stripPathPrefix("/l/abc123", "")).toBeNull();
  });

  it("does not apply when the first segment is a different keyword", () => {
    expect(stripPathPrefix("/abc123", "l")).toBeNull();
    expect(stripPathPrefix("/abc123/deep", "l")).toBeNull();
  });

  it("matches whole segments only", () => {
    // "list" starts with "l" but is a keyword, not the prefix.
    expect(stripPathPrefix("/list/abc123", "l")).toBeNull();
    expect(stripPathPrefix("/lab", "l")).toBeNull();
  });

  it("leaves a bare keyword equal to the prefix alone", () => {
    // A root-level link whose keyword happens to be "l" must keep resolving.
    expect(stripPathPrefix("/l", "l")).toBeNull();
  });

  it("is case-sensitive, like keywords", () => {
    expect(stripPathPrefix("/L/abc123", "l")).toBeNull();
  });

  it("does not apply to a trailing slash after the prefix", () => {
    // "/l/" carries the prefix but names no keyword, so the prefix does not
    // apply and the proxy passes the path through untouched. Null rather than
    // "/" so the answer matches fallbackKeywordFromSegments(["l", ""], "l").
    expect(stripPathPrefix("/l/", "l")).toBeNull();
  });

  it("keeps a trailing slash after the keyword", () => {
    expect(stripPathPrefix("/l/abc123/", "l")).toBe("/abc123/");
  });

  it("carries the preview suffix through", () => {
    expect(stripPathPrefix("/l/abc123+", "l")).toBe("/abc123+");
  });

  it("ignores a stored prefix that contains a slash", () => {
    // Cannot be written through the API; guarded so a hand-edited document
    // degrades to root-only resolution rather than matching "//".
    expect(stripPathPrefix("/l/abc/123", "l/abc")).toBeNull();
  });

  it("supports a multi-character prefix", () => {
    expect(stripPathPrefix("/short/abc123", "short")).toBe("/abc123");
  });
});

/**
 * The gate on the degradation path. The route behind it is a catch-all, so
 * every case here is really the question "may this path, which had no route at
 * all before, start reading the database?". Null is the safe answer and the
 * one that preserves today's 404.
 */
describe("fallbackKeywordFromSegments", () => {
  it("resolves a prefixed path on a prefixed domain", () => {
    expect(fallbackKeywordFromSegments(["l", "abc123"], "l")).toBe("abc123");
  });

  it("resolves an unprefixed path on a prefixed domain", () => {
    // A domain that adds a prefix keeps the root links it already had.
    expect(fallbackKeywordFromSegments(["abc123"], "l")).toBe("abc123");
  });

  it("refuses a two-segment path on a domain with no prefix", () => {
    expect(fallbackKeywordFromSegments(["l", "abc123"], null)).toBeNull();
    expect(fallbackKeywordFromSegments(["l", "abc123"], undefined)).toBeNull();
    expect(fallbackKeywordFromSegments(["l", "abc123"], "")).toBeNull();
  });

  it("refuses a two-segment path whose first segment is not the prefix", () => {
    expect(fallbackKeywordFromSegments(["x", "abc123"], "l")).toBeNull();
    // "list" starts with "l" but is a whole segment of its own.
    expect(fallbackKeywordFromSegments(["list", "abc123"], "l")).toBeNull();
  });

  it("is case-sensitive, like keywords", () => {
    expect(fallbackKeywordFromSegments(["L", "abc123"], "l")).toBeNull();
  });

  it("never treats an association-file path as a link", () => {
    for (const path of Object.keys(APP_ASSOCIATION_PATHS)) {
      const segments = path.split("/").filter(Boolean);
      expect(fallbackKeywordFromSegments(segments, null), path).toBeNull();
      // Even if a prefix were hand-written into MongoDB to match one.
      expect(fallbackKeywordFromSegments(segments, segments[0]), path).toBeNull();
    }
  });

  it("never treats a platform path as a link, whatever the stored prefix", () => {
    for (const prefix of BYPASS_PREFIXES) {
      const segment = prefix.replace(/^\//, "");
      expect(fallbackKeywordFromSegments([segment, "abc123"], segment), segment).toBeNull();
    }
  });

  it("refuses anything deeper than a prefixed keyword", () => {
    // Forwarded deeplink paths are the edge resolver's business; the fallback
    // 404s them exactly as it does for a root multi-segment path today.
    expect(fallbackKeywordFromSegments(["l", "abc123", "deep"], "l")).toBeNull();
    expect(fallbackKeywordFromSegments(["abc123", "deep"], null)).toBeNull();
  });

  it("refuses an empty or absent path", () => {
    expect(fallbackKeywordFromSegments([], "l")).toBeNull();
    expect(fallbackKeywordFromSegments(undefined, "l")).toBeNull();
    expect(fallbackKeywordFromSegments([""], null)).toBeNull();
    expect(fallbackKeywordFromSegments(["l", ""], "l")).toBeNull();
  });

  it("passes a single segment through unchanged, dots included", () => {
    // Today's single dynamic route handed these straight to the database, and
    // this must stay byte for byte what it was.
    expect(fallbackKeywordFromSegments(["abc.json"], null)).toBe("abc.json");
    expect(fallbackKeywordFromSegments(["abc123+"], null)).toBe("abc123+");
  });

  it("ignores a stored prefix that contains a slash", () => {
    expect(fallbackKeywordFromSegments(["l", "abc123"], "l/x")).toBeNull();
  });

  it("agrees with stripPathPrefix about which keyword a path names", () => {
    // The edge and the fallback must never disagree, since drift here is only
    // ever visible during an outage.
    const stripped = stripPathPrefix("/l/abc123", "l");
    expect(stripped).toBe("/abc123");
    expect(fallbackKeywordFromSegments(["l", "abc123"], "l")).toBe(stripped?.slice(1));
  });
});

describe("deeplinkConfigSchema pathPrefix", () => {
  const parse = (pathPrefix: unknown) => deeplinkConfigSchema.safeParse({ pathPrefix });

  it("accepts a plain segment", () => {
    const result = parse("l");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pathPrefix).toBe("l");
  });

  it("accepts digits, hyphens and underscores", () => {
    expect(parse("go-2_x").success).toBe(true);
  });

  it("stores the slash-free canonical form", () => {
    const result = parse("/l/");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pathPrefix).toBe("l");
  });

  it("accepts null to clear the prefix", () => {
    const result = parse(null);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pathPrefix).toBeNull();
  });

  it("leaves the prefix unchanged when the field is absent", () => {
    const result = deeplinkConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect("pathPrefix" in result.data).toBe(false);
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(parse("").success).toBe(false);
    expect(parse("   ").success).toBe(false);
  });

  it("rejects more than one segment", () => {
    expect(parse("l/deep").success).toBe(false);
    expect(parse("a/b/c").success).toBe(false);
  });

  it("rejects characters that would change the URL's meaning", () => {
    for (const value of ["l.json", "l?x", "l#a", "l%2f", "l l", "..", "l:1"]) {
      expect(parse(value).success, value).toBe(false);
    }
  });

  it("tolerates surrounding whitespace from a pasted value", () => {
    const result = parse("  l  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pathPrefix).toBe("l");
  });

  it("rejects a value over the length cap", () => {
    expect(parse("a".repeat(33)).success).toBe(false);
    expect(parse("a".repeat(32)).success).toBe(true);
  });

  it("rejects every path the proxy bypasses", () => {
    for (const prefix of BYPASS_PREFIXES) {
      const segment = prefix.replace(/^\//, "");
      expect(parse(segment).success, segment).toBe(false);
    }
  });

  it("rejects the association-file and api segments regardless of case", () => {
    for (const value of ["well-known", "Well-Known", "api", "API", "_next", "assets"]) {
      expect(parse(value).success, value).toBe(false);
    }
  });

  it("rejects every name the middleware matcher skips, and anything starting with one", () => {
    // The matcher's negative lookahead is a raw string test at position 1, not
    // a segment test, so "/icons/abc" skips the middleware just as "/icon"
    // does. A prefix of "icons" would therefore take every link under it out
    // of the resolve endpoint and its rate limit, and onto the outage-only
    // fallback page, which writes to Mongo per request.
    for (const name of MATCHER_EXCLUDED_NAMES) {
      expect(parse(name).success, name).toBe(false);
      expect(parse(`${name}s`).success, `${name}s`).toBe(false);
      expect(parse(`${name.toUpperCase()}x`).success, name).toBe(false);
    }

    for (const value of ["icons", "assetsx", "_nextgen", "apple-iconic", "opengraph-images"]) {
      expect(parse(value).success, value).toBe(false);
    }
  });

  it("still accepts the ordinary prefixes a customer would choose", () => {
    for (const value of ["l", "go", "s", "r", "link", "short", "u"]) {
      const result = parse(value);
      expect(result.success, value).toBe(true);
    }
  });
});

describe("reserved path prefixes", () => {
  it("matches bypass prefixes by whole segment only", () => {
    expect(isReservedPathPrefix("stats")).toBe(true);
    // A keyword-shaped extension of a bypass prefix is fine: the proxy matches
    // those by segment, so "statsboard" never collides.
    expect(isReservedPathPrefix("statsboard")).toBe(false);
    expect(isReservedPathPrefix("apiary")).toBe(false);
  });

  it("matches matcher exclusions by string prefix, as the regex does", () => {
    expect(isReservedPathPrefix("icon")).toBe(true);
    expect(isReservedPathPrefix("icons")).toBe(true);
    expect(isReservedPathPrefix("assetsx")).toBe(true);
    expect(isReservedPathPrefix("_nextgen")).toBe(true);
  });
});

/**
 * A keyword the matcher skips is a redirect path with no rate limit on it: the
 * request never reaches /api/internal/resolve, so it never meets that route's
 * 120/min, and it lands on the outage-only fallback page, which writes a Click
 * and increments the link on every hit. Both schemas that let a caller choose a
 * keyword must refuse one, and refuse it by string prefix, because that is what
 * the matcher's lookahead tests.
 */
describe("keywords the middleware matcher would skip", () => {
  const shorten = (keyword: string) =>
    shortenSchema.safeParse({ url: "https://example.com/", keyword });
  const edit = (keyword: string) => editLinkSchema.safeParse({ keyword });

  it("rejects every excluded name, and anything beginning with one", () => {
    for (const name of MATCHER_EXCLUDED_NAMES) {
      // The dotted names cannot pass the keyword regex anyway, so they are
      // asserted through the shared predicate rather than through a schema
      // that would reject them for the wrong reason.
      expect(startsWithMatcherExcludedName(name), name).toBe(true);
      expect(startsWithMatcherExcludedName(`${name}x`), `${name}x`).toBe(true);
    }

    // The slug-shaped ones, end to end through both schemas. Each is a keyword
    // the old regex accepted and the matcher skips.
    for (const keyword of [
      "_next",
      "_nextx",
      "assets",
      "assets1",
      "icon",
      "iconoclast",
      "apple-icon",
      "apple-iconz",
      "opengraph-image",
      "opengraph-imagex",
    ]) {
      expect(shorten(keyword).success, `shorten ${keyword}`).toBe(false);
      expect(edit(keyword).success, `edit ${keyword}`).toBe(false);
    }
  });

  it("rejects regardless of case, since the check is not the regex", () => {
    for (const keyword of ["ICONOCLAST", "Assets1", "_NextX"]) {
      expect(shorten(keyword).success, keyword).toBe(false);
    }
  });

  it("still accepts ordinary keywords, including near misses", () => {
    // The boundary is a raw string prefix, so it is worth being deliberate:
    // "assetmanager" does NOT begin with "assets" (no "s" before the "m") and
    // must keep working, while "assetsmanager" does and must not. Likewise
    // "iphone" shares no prefix with "icon" despite starting with an "i", and
    // "applecart" is not "apple-icon".
    for (const keyword of [
      "promo",
      "iphone",
      "assetmanager",
      "asset",
      "ico",
      "applecart",
      "opengraph",
      "next",
      "book-2026",
    ]) {
      expect(shorten(keyword).success, `shorten ${keyword}`).toBe(true);
      expect(edit(keyword).success, `edit ${keyword}`).toBe(true);
    }

    expect(shorten("assetsmanager").success).toBe(false);
  });

  it("leaves an omitted keyword alone, so a generated one is unaffected", () => {
    expect(shortenSchema.safeParse({ url: "https://example.com/" }).success).toBe(true);
    expect(editLinkSchema.safeParse({}).success).toBe(true);
  });
});

describe("buildMatcherPattern", () => {
  it("reproduces the shipped matcher literal, byte for byte", () => {
    // Pinned to the exact string in src/proxy.ts, so the generated form can
    // never quietly widen or narrow what the middleware runs on. Note the
    // escaped dots: unescaped, "/faviconXico" would skip the middleware.
    expect(buildMatcherPattern()).toBe(
      "/((?!_next|assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|icon|apple-icon|opengraph-image).*)"
    );
  });

  it("matches the matcher the middleware actually exports", () => {
    // The real drift guard. src/proxy.ts must keep a literal here (Turbopack
    // parses config.matcher statically), so this asserts that literal against
    // the list the pathPrefix validation is derived from. Read from source
    // rather than imported, because importing the middleware would pull in the
    // edge runtime for no benefit.
    const source = readFileSync(
      new URL("../../proxy.ts", import.meta.url),
      "utf8"
    );
    // All occurrences, not the first. `config.matcher` is an array, so a second
    // literal would widen what the middleware runs on while a first-match test
    // stayed green. Exactly one is the invariant.
    const literals = [...source.matchAll(/"(\/\(\(\?![^"]+)"/g)].map((m) => m[1]);
    expect(literals, "src/proxy.ts must declare exactly one matcher literal").toHaveLength(1);
    const literal = literals[0];
    // The captured text is still TypeScript source, so its escapes are doubled.
    expect(JSON.parse(`"${literal}"`)).toBe(buildMatcherPattern());
  });

  it("skips exactly the paths the matcher is meant to skip", () => {
    const matcher = new RegExp(`^${buildMatcherPattern()}$`);

    for (const path of ["/abc123", "/l/abc123", "/dashboard", "/api/v1/links"]) {
      expect(matcher.test(path), path).toBe(true);
    }

    for (const path of [
      "/_next/static/x.js",
      "/assets/logo.svg",
      "/favicon.ico",
      "/robots.txt",
      "/icon",
      "/icons/abc123",
      "/apple-icon",
      "/opengraph-image",
      // Pre-existing and unchanged by this generation: the lookahead is a raw
      // prefix test, so a root keyword beginning with an excluded name skips
      // the middleware too. Pinned here because it is the exact semantics the
      // prefix validation now mirrors.
      "/iconoclast",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("keeps a dot in an excluded name literal", () => {
    const matcher = new RegExp(`^${buildMatcherPattern()}$`);
    // Unescaped, "." would match any character and "/faviconXico" would skip.
    expect(matcher.test("/faviconXico")).toBe(true);
  });
});

/**
 * The two entry points must name the same keyword for the same request. Drift
 * here only ever shows up while the internal resolve API is down, which is the
 * one moment nobody can afford to debug it, so the agreement is asserted from
 * a shared table rather than left to the shared predicate alone.
 */
describe("edge and fallback agreement", () => {
  /**
   * The proxy's shortener-mode keyword derivation, in one place: strip the
   * prefix, take the preview suffix off, then reject anything that is empty,
   * carries a dot, or still holds a separator. Deeplink mode is deliberately
   * out of scope: the fallback never serves a forwarded path, and both sides
   * agree that such a path resolves no keyword here.
   */
  const edgeKeyword = (pathname: string, prefix: string | null): string | null => {
    const resolvePath = stripPathPrefix(pathname, prefix) ?? pathname;
    const isPreview = resolvePath.endsWith("+");
    const keyword = isPreview ? resolvePath.slice(1, -1) : resolvePath.slice(1);
    if (!keyword || keyword.includes(".") || keyword.includes("/")) return null;
    return isPreview ? `${keyword}+` : keyword;
  };

  /** Segments as Next hands them to a catch-all, empties included. */
  const segmentsOf = (pathname: string): string[] => pathname.slice(1).split("/");

  const cases: ReadonlyArray<[pathname: string, prefix: string | null, keyword: string | null]> = [
    ["/abc123", null, "abc123"],
    ["/abc123", "l", "abc123"],
    ["/l", "l", "l"],
    ["/l/abc123", "l", "abc123"],
    ["/short/abc123", "short", "abc123"],
    // Trailing slash and an empty second segment: the prefix is there, the
    // keyword is not, so neither side resolves anything.
    ["/l/", "l", null],
    ["/l//abc123", "l", null],
    // Preview suffix survives the prefix on both sides.
    ["/l/abc123+", "l", "abc123+"],
    // Case boundaries: matching is case-sensitive, like keywords.
    ["/L/abc123", "l", null],
    ["/l/ABC123", "l", "ABC123"],
    // Whole segments only.
    ["/list/abc123", "l", null],
    // Two segments with no prefix configured must keep 404ing.
    ["/l/abc123", null, null],
    // Deeper than a prefixed keyword: not this route's business either way.
    ["/l/abc123/deep", "l", null],
    // A reserved prefix written straight into MongoDB is refused on both
    // sides, not only by the schema.
    ["/icons/abc123", "icons", null],
    ["/stats/abc123", "stats", null],
  ];

  it.each(cases)("agrees on %s under prefix %s", (pathname, prefix, expected) => {
    expect(edgeKeyword(pathname, prefix), `edge: ${pathname}`).toBe(expected);
    expect(
      fallbackKeywordFromSegments(segmentsOf(pathname), prefix),
      `fallback: ${pathname}`
    ).toBe(expected);
  });
});
