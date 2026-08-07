import { describe, it, expect } from "vitest";
import {
  bulkImportSchema,
  editLinkSchema,
  shortenSchema,
  syncClickSchema,
  syncLinkSchema,
  syncUpdateClicksSchema,
} from "../validations";

/**
 * The YOURLS sync webhook reads its fields from a JSON body, which is what
 * makes it different from every other keyword-taking route: a path or search
 * parameter is always a string, a JSON value is whatever the caller sent. The
 * cases below are written as "what a hostile body can be", not as field-by-
 * field coverage.
 */
describe("sync webhook schemas", () => {
  const operators = [
    { $ne: null },
    { $gt: "" },
    { $regex: ".*" },
    ["a"],
    123,
    true,
    null,
  ];

  it("refuses a non-string keyword on every event", () => {
    for (const keyword of operators) {
      expect(syncClickSchema.safeParse({ keyword }).success, JSON.stringify(keyword)).toBe(false);
      expect(
        syncLinkSchema.safeParse({ keyword, url: "https://example.com/" }).success,
        JSON.stringify(keyword)
      ).toBe(false);
      expect(
        syncUpdateClicksSchema.safeParse({ keyword, clicks: 1 }).success,
        JSON.stringify(keyword)
      ).toBe(false);
    }
  });

  it("refuses a non-number click count, which reached $set and $inc unchecked", () => {
    expect(syncUpdateClicksSchema.safeParse({ keyword: "abc", clicks: { $ne: 1 } }).success).toBe(
      false
    );
    expect(syncUpdateClicksSchema.safeParse({ keyword: "abc", clicks: "5" }).success).toBe(false);
    expect(syncUpdateClicksSchema.safeParse({ keyword: "abc", clicks: -1 }).success).toBe(false);
    expect(syncUpdateClicksSchema.safeParse({ keyword: "abc", clicks: 1.5 }).success).toBe(false);
    expect(syncUpdateClicksSchema.safeParse({ keyword: "abc", clicks: 12 }).success).toBe(true);
  });

  it("refuses to mint a keyword that skips the middleware", () => {
    // The last writer that could still do this. "iconoclast" begins with
    // "icon", so the matcher's lookahead takes it out of the middleware and off
    // the metered resolve path for good.
    for (const keyword of ["iconoclast", "_nextx", "assets1", "dashboard", "admin"]) {
      expect(
        syncLinkSchema.safeParse({ keyword, url: "https://example.com/" }).success,
        keyword
      ).toBe(false);
    }
  });

  it("refuses a link URL the platform would not redirect to", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", { $ne: null }, ""]) {
      expect(syncLinkSchema.safeParse({ keyword: "promo", url }).success, String(url)).toBe(false);
    }
  });

  it("accepts a well-formed link event", () => {
    const parsed = syncLinkSchema.safeParse({
      keyword: "promo",
      url: "https://example.com/page",
      title: "Example",
      ip: "203.0.113.7",
      clicks: 42,
      timestamp: "2024-01-02 03:04:05",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.timestamp instanceof Date).toBe(true);
  });

  it("keeps accepting the MySQL datetime text the plugin actually sends", () => {
    // Not ISO 8601, and the previous `new Date(value)` took it happily. A
    // stricter datetime check here would break the live sender.
    expect(syncClickSchema.safeParse({ keyword: "promo", clickTime: "2024-01-02 03:04:05" }).success).toBe(
      true
    );
    expect(syncClickSchema.safeParse({ keyword: "promo", clickTime: "not a date" }).success).toBe(
      false
    );
    expect(syncClickSchema.safeParse({ keyword: "promo", clickTime: { $ne: null } }).success).toBe(
      false
    );
  });

  it("still looks up a legacy single-character keyword", () => {
    // Click and heartbeat events only read an existing link, so the mint-time
    // minimum length must not apply: YOURLS keywords predate this platform and
    // may be one character. Refusing them would drop click data.
    expect(syncClickSchema.safeParse({ keyword: "a" }).success).toBe(true);
    expect(syncUpdateClicksSchema.safeParse({ keyword: "a", clicks: 3 }).success).toBe(true);
    expect(syncLinkSchema.safeParse({ keyword: "a", url: "https://example.com/" }).success).toBe(
      false
    );
  });

  it("refuses a non-string free-text field", () => {
    expect(syncClickSchema.safeParse({ keyword: "promo", referrer: { $ne: null } }).success).toBe(
      false
    );
    expect(syncClickSchema.safeParse({ keyword: "promo", userAgent: ["x"] }).success).toBe(false);
    expect(syncClickSchema.safeParse({ keyword: "promo", ip: { $ne: null } }).success).toBe(false);
    expect(syncClickSchema.safeParse({ keyword: "promo", countryCode: "GBR" }).success).toBe(false);
    expect(syncClickSchema.safeParse({ keyword: "promo", countryCode: "GB" }).success).toBe(true);
  });
});

describe("bulkImportSchema keyword", () => {
  const bulk = (keyword: unknown) =>
    bulkImportSchema.safeParse([{ url: "https://example.com/", keyword }]);

  it("applies the same minimum length as the single-link schemas", () => {
    // The inconsistency: bulk import accepted "a" where both other writers
    // refused it, so the same keyword was valid or invalid depending on which
    // endpoint a caller reached for.
    expect(bulk("a").success).toBe(false);
    expect(shortenSchema.safeParse({ url: "https://example.com/", keyword: "a" }).success).toBe(
      false
    );
    expect(editLinkSchema.safeParse({ keyword: "a" }).success).toBe(false);
    expect(bulk("ab").success).toBe(true);
  });

  it("keeps the empty string meaning a generated keyword", () => {
    // `bulk/route.ts` reads `item.keyword?.trim() || generateKeyword()`, so ""
    // has always meant "generate one". Tightening the minimum must not change
    // that for a caller who sends the field on every row.
    expect(bulk("").success).toBe(true);
    expect(bulkImportSchema.safeParse([{ url: "https://example.com/" }]).success).toBe(true);
  });

  it("keeps refusing a reserved keyword", () => {
    expect(bulk("iconoclast").success).toBe(false);
    expect(bulk("promo").success).toBe(true);
  });
});
