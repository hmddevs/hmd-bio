import { describe, it, expect } from "vitest";
import { deeplinkConfigSchema, shortenSchema } from "../validations";
import { APP_LINKS_MAXLENGTH } from "../../models/Domain";

function expectOk(result: { success: boolean }) {
  expect(result.success).toBe(true);
}

function expectFail(result: { success: boolean }) {
  expect(result.success).toBe(false);
}

describe("deeplinkConfigSchema aasa", () => {
  it("accepts a JSON object containing 'applinks'", () => {
    const result = deeplinkConfigSchema.safeParse({
      appLinks: { aasa: JSON.stringify({ applinks: { details: [] } }) },
    });
    expectOk(result);
  });

  it("rejects a JSON object with none of the recognised top-level keys", () => {
    const result = deeplinkConfigSchema.safeParse({
      appLinks: { aasa: JSON.stringify({ unrelated: true }) },
    });
    expectFail(result);
  });

  it("rejects a bare JSON string", () => {
    const result = deeplinkConfigSchema.safeParse({
      appLinks: { aasa: JSON.stringify("just a string") },
    });
    expectFail(result);
  });

  it("rejects a JSON array", () => {
    const result = deeplinkConfigSchema.safeParse({
      appLinks: { aasa: JSON.stringify([{ applinks: {} }]) },
    });
    expectFail(result);
  });

  it("rejects malformed JSON", () => {
    const result = deeplinkConfigSchema.safeParse({
      appLinks: { aasa: "{not valid json" },
    });
    expectFail(result);
  });

  it("rejects a value over the 128 KB byte cap", () => {
    const oversized = JSON.stringify({
      applinks: { padding: "x".repeat(APP_LINKS_MAXLENGTH) },
    });
    const result = deeplinkConfigSchema.safeParse({
      appLinks: { aasa: oversized },
    });
    expectFail(result);
  });
});

describe("deeplinkConfigSchema assetlinks", () => {
  it("accepts a JSON array of objects", () => {
    const result = deeplinkConfigSchema.safeParse({
      appLinks: {
        assetlinks: JSON.stringify([
          { relation: ["delegate_permission/common.handle_all_urls"], target: {} },
        ]),
      },
    });
    expectOk(result);
  });

  it("rejects a plain object (the aasa shape) instead of an array", () => {
    const result = deeplinkConfigSchema.safeParse({
      appLinks: { assetlinks: JSON.stringify({ applinks: {} }) },
    });
    expectFail(result);
  });
});

describe("deeplinkConfigSchema fallbackTarget", () => {
  it("accepts an https URL", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "https://example.com/landing",
    });
    expectOk(result);
  });

  it("rejects a javascript: value", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "javascript:alert(1)",
    });
    expectFail(result);
  });

  it("rejects a URL carrying userinfo", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "https://user:pass@example.com/landing",
    });
    expectFail(result);
  });
});

describe("linkTargetsField (via shortenSchema-shaped usage)", () => {
  // linkTargetsField is not exported directly; exercised through the schemas
  // that embed it. shortenSchema is used here rather than deeplinkConfigSchema
  // because deeplinkConfigSchema does not carry `targets`.

  it("accepts up to 3 targets", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [
        { platform: "ios", url: "https://example.com/ios" },
        { platform: "android", url: "https://example.com/android" },
        { platform: "desktop", url: "https://example.com/desktop" },
      ],
    });
    expectOk(result);
  });

  it("rejects more than 3 targets", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [
        { platform: "ios", url: "https://example.com/1" },
        { platform: "android", url: "https://example.com/2" },
        { platform: "desktop", url: "https://example.com/3" },
        { platform: "ios", url: "https://example.com/4" },
      ],
    });
    expectFail(result);
  });

  it("rejects duplicate platforms", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [
        { platform: "ios", url: "https://example.com/1" },
        { platform: "ios", url: "https://example.com/2" },
      ],
    });
    expectFail(result);
  });

  it("rejects a target with an invalid URL", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [{ platform: "ios", url: "not-a-url" }],
    });
    expectFail(result);
  });

  it("rejects a target URL carrying userinfo", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [{ platform: "ios", url: "https://user:pass@example.com/ios" }],
    });
    expectFail(result);
  });

  it("rejects a target with a javascript: URL", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [{ platform: "ios", url: "javascript:alert(1)" }],
    });
    expectFail(result);
  });
});

describe("absoluteHttpUrl transform output (regression: schema must store the parsed URL, not the raw input)", () => {
  // These assert on `.data`, the value a caller would actually persist. The
  // pre-fix `superRefine` validated `new URL(value)` but returned `value`
  // unchanged, so every one of these would have passed the old tests while
  // storing a string that disagreed with what was validated.

  it("strips an embedded LF from the scheme before storing", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "ht\ntps://good.com/",
    });
    expectOk(result);
    expect(result.data?.fallbackTarget).toBe("https://good.com/");
  });

  it("resolves a tab hidden inside the host to the genuinely different host it parses as", () => {
    // WHATWG URL parsing strips tabs, CRs and LFs from anywhere in the string
    // before splitting out the host, so "good.com<TAB>.evil.com" is not
    // "good.com" with a stray tab: it parses as the single host
    // "good.com.evil.com", which is what must be stored, not the visually
    // deceptive original.
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "https://good.com\t.evil.com/",
    });
    expectOk(result);
    expect(result.data?.fallbackTarget).toBe("https://good.com.evil.com/");
  });

  it("collapses an embedded CRLF header-injection attempt onto a single percent-encoded line", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "https://good.com/\r\nLocation: https://evil.com",
    });
    expectOk(result);
    expect(result.data?.fallbackTarget).toBe(
      "https://good.com/Location:%20https://evil.com"
    );
    expect(result.data?.fallbackTarget).not.toContain("\r");
    expect(result.data?.fallbackTarget).not.toContain("\n");
  });

  it("still rejects a non-http(s) scheme with the original message", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "javascript:alert(1)",
    });
    expectFail(result);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Only http and https URLs are allowed"
      );
    }
  });

  it("still rejects embedded credentials with the original message", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "https://user:pass@example.com/landing",
    });
    expectFail(result);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "A URL must not contain credentials"
      );
    }
  });

  it("still rejects a URL over the 2048 character cap with the original message", () => {
    const overLong = `https://example.com/${"a".repeat(2048)}`;
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: overLong,
    });
    expectFail(result);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("URL is too long");
    }
  });

  it("still rejects an unparseable value with the original message", () => {
    const result = deeplinkConfigSchema.safeParse({
      fallbackTarget: "not a url at all",
    });
    expectFail(result);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Enter an absolute URL, including https://"
      );
    }
  });

  it("leaves an explicit null fallbackTarget as null after parsing", () => {
    const result = deeplinkConfigSchema.safeParse({ fallbackTarget: null });
    expectOk(result);
    expect(result.data?.fallbackTarget).toBeNull();
  });

  it("leaves fallbackTarget absent when the field is omitted", () => {
    const result = deeplinkConfigSchema.safeParse({});
    expectOk(result);
    expect(result.data && "fallbackTarget" in result.data).toBe(false);
  });

  it("normalises a target URL nested inside shortenSchema's targets array", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [{ platform: "ios", url: "https://good.com\t.evil.com/ios" }],
    });
    expectOk(result);
    expect(result.data?.targets?.[0]?.url).toBe(
      "https://good.com.evil.com/ios"
    );
  });

  it("still caps targets at three once every element has been through the transform", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [
        { platform: "ios", url: "ht\ntps://example.com/1" },
        { platform: "android", url: "ht\ntps://example.com/2" },
        { platform: "desktop", url: "ht\ntps://example.com/3" },
        { platform: "ios", url: "ht\ntps://example.com/4" },
      ],
    });
    expectFail(result);
  });

  it("still rejects duplicate platforms once every element has been through the transform", () => {
    const result = shortenSchema.safeParse({
      url: "https://example.com",
      targets: [
        { platform: "ios", url: "ht\ntps://example.com/1" },
        { platform: "ios", url: "ht\ntps://example.com/2" },
      ],
    });
    expectFail(result);
  });
});
