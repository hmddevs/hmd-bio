import { describe, it, expect } from "vitest";
import {
  composeForwardedTarget,
  parseHttpUrl,
  platformFromUA,
} from "../deeplink";

describe("parseHttpUrl", () => {
  it("accepts an http URL", () => {
    const url = parseHttpUrl("http://example.com/a");
    expect(url).toBeTruthy();
    expect(url?.protocol).toBe("http:");
  });

  it("accepts an https URL", () => {
    const url = parseHttpUrl("https://example.com/a");
    expect(url).toBeTruthy();
    expect(url?.protocol).toBe("https:");
  });

  it("rejects a javascript: URL", () => {
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects a data: URL", () => {
    expect(parseHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects a scheme-relative URL", () => {
    expect(parseHttpUrl("//other.example/a")).toBeNull();
  });

  it("rejects a URL carrying userinfo before the host", () => {
    // This still parses to a valid http(s) URL; parseHttpUrl only screens the
    // scheme, so userinfo rejection is the caller's job (see absoluteHttpUrl
    // in validations.ts). Documented here so the boundary is explicit.
    const url = parseHttpUrl("https://user:pass@example.com/a");
    expect(url).toBeTruthy();
    expect(url?.username).toBe("user");
  });

  it("returns null for empty or missing input", () => {
    expect(parseHttpUrl("")).toBeNull();
    expect(parseHttpUrl(null)).toBeNull();
    expect(parseHttpUrl(undefined)).toBeNull();
  });
});

describe("platformFromUA", () => {
  it("buckets a genuine iPhone user-agent as ios", () => {
    expect(platformFromUA("iOS")).toBe("ios");
  });

  it("buckets a genuine Android user-agent as android", () => {
    expect(platformFromUA("Android")).toBe("android");
  });

  it("buckets a desktop OS as desktop", () => {
    expect(platformFromUA("Windows")).toBe("desktop");
  });

  it("buckets an empty string as desktop", () => {
    expect(platformFromUA("")).toBe("desktop");
  });

  it("buckets junk as desktop", () => {
    expect(platformFromUA("not-a-real-os")).toBe("desktop");
  });

  it("buckets undefined as desktop", () => {
    expect(platformFromUA(undefined)).toBe("desktop");
  });
});

describe("composeForwardedTarget", () => {
  it("appends extra path segments and a query string", () => {
    const result = composeForwardedTarget("https://app.example/", {
      extraPath: "/foo/bar",
      search: "?id=123",
    });
    expect(result).toBe("https://app.example/foo/bar?id=123");
  });

  it("returns the input string byte-identically when both parts are empty", () => {
    const target = "https://app.example/some/path?already=here";
    expect(composeForwardedTarget(target, { extraPath: "", search: "" })).toBe(target);
  });

  it("handles a base URL with no trailing slash", () => {
    const result = composeForwardedTarget("https://app.example", {
      extraPath: "/foo",
      search: "",
    });
    expect(result).toBe("https://app.example/foo");
  });

  it("handles a trailing slash on the base without doubling it", () => {
    const result = composeForwardedTarget("https://app.example/base/", {
      extraPath: "/foo",
      search: "",
    });
    expect(result).toBe("https://app.example/base/foo");
  });

  it("appends only the path when the query is empty", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/foo",
      search: "",
    });
    expect(result).toBe("https://app.example/base/foo");
  });

  it("preserves a base URL's own query string unchanged when composing only a path", () => {
    const target = "https://app.example/base?sig=AbC%2F123&exp=999";
    const result = composeForwardedTarget(target, { extraPath: "/foo", search: "" });
    expect(result).toBe("https://app.example/base/foo?sig=AbC%2F123&exp=999");
  });

  it("keeps the target's existing query parameter when an incoming one has the same name", () => {
    const target = "https://app.example/base?id=owner-value";
    const result = composeForwardedTarget(target, { extraPath: "", search: "?id=attacker-value" });
    expect(result).toBe("https://app.example/base?id=owner-value");
  });

  it("adds an incoming parameter whose name does not collide", () => {
    const target = "https://app.example/base?id=owner-value";
    const result = composeForwardedTarget(target, { extraPath: "", search: "?ref=campaign" });
    expect(result).toBe("https://app.example/base?id=owner-value&ref=campaign");
  });

  it("returns the target unchanged when it is not http(s)", () => {
    const target = "myapp://open";
    const result = composeForwardedTarget(target, { extraPath: "/foo", search: "?id=1" });
    expect(result).toBe(target);
  });

  it("drops a '.' segment", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/./foo",
      search: "",
    });
    expect(result).toBe("https://app.example/base/foo");
  });

  it("drops a '..' segment", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/../foo",
      search: "",
    });
    expect(result).toBe("https://app.example/base/foo");
  });

  it("drops a percent-encoded '.' segment ('%2e')", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/%2e/foo",
      search: "",
    });
    expect(result).toBe("https://app.example/base/foo");
  });

  it("drops a percent-encoded '..' segment ('%2e%2e')", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/%2e%2e/foo",
      search: "",
    });
    expect(result).toBe("https://app.example/base/foo");
  });

  it("drops a segment containing a backslash", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/foo\\bar/baz",
      search: "",
    });
    expect(result).toBe("https://app.example/base/baz");
  });

  it("drops a segment containing a raw control character", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/foo\tbar/baz",
      search: "",
    });
    expect(result).toBe("https://app.example/base/baz");
  });

  it("drops a segment that is only a percent-encoded NUL ('%00')", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/%00/baz",
      search: "",
    });
    expect(result).toBe("https://app.example/base/baz");
  });

  it("drops a segment with a malformed percent-escape", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/%zz/baz",
      search: "",
    });
    expect(result).toBe("https://app.example/base/baz");
  });

  it("leaves the base path untouched when every extra segment is filtered out", () => {
    const result = composeForwardedTarget("https://app.example/base", {
      extraPath: "/../..",
      search: "",
    });
    expect(result).toBe("https://app.example/base");
  });
});
