import { describe, expect, it } from "vitest";
import {
  SESSION_ACCESS,
  accessPermitsDomain,
  domainScopeFilter,
  requiredScopeForMethod,
  resolveKeyAccess,
  resolveKeyDomains,
  resolveKeyScope,
  scopePermits,
  summariseKeyScope,
  type CallerAccess,
  type StoredKeyScoping,
} from "@/lib/api-key-scope";
import { User } from "@/models/User";
import { apiKeySchema } from "@/lib/validations";

/** The shape of a key minted before scoping existed: none of the fields set. */
const LEGACY_KEY: StoredKeyScoping = {};

function access(overrides: Partial<CallerAccess> = {}): CallerAccess {
  return { via: "api-key", scope: "write", domains: null, keyId: null, ...overrides };
}

function accessFor(key: StoredKeyScoping, now = new Date()): CallerAccess {
  const result = resolveKeyAccess(key, now);
  if (!result.ok) throw new Error("expected the key to resolve");
  return result.access;
}

describe("a key from before scoping existed", () => {
  it("keeps full access when it has no scoping fields at all", () => {
    const result = resolveKeyAccess(LEGACY_KEY);

    expect(result).toEqual({
      ok: true,
      access: { via: "api-key", scope: "write", domains: null, keyId: null },
    });
  });

  it("may write, because that is what it could do before", () => {
    expect(scopePermits(accessFor(LEGACY_KEY), "write")).toBe(true);
    expect(scopePermits(accessFor(LEGACY_KEY), "read")).toBe(true);
  });

  it("reaches every domain, including one it has never been told about", () => {
    const legacy = accessFor(LEGACY_KEY);

    expect(accessPermitsDomain(legacy, "hmd.bio")).toBe(true);
    expect(accessPermitsDomain(legacy, "go.glasspadelapp.com")).toBe(true);
  });

  it("adds no filter to a list query", () => {
    expect(domainScopeFilter(accessFor(LEGACY_KEY))).toEqual({});
  });

  it("never expires", () => {
    const farFuture = new Date("2099-01-01T00:00:00.000Z");
    expect(resolveKeyAccess(LEGACY_KEY, farFuture).ok).toBe(true);
  });

  it("is unaffected by fields explicitly stored as null", () => {
    // Mongoose can write an explicit null where a value was cleared. That must
    // read the same as absent, not as a restriction.
    const cleared: StoredKeyScoping = { scope: null, domains: null, expiresAt: null };

    expect(resolveKeyAccess(cleared)).toEqual({
      ok: true,
      access: { via: "api-key", scope: "write", domains: null, keyId: null },
    });
  });
});

describe("read and write scope", () => {
  it("denies a write to a read-only key", () => {
    expect(scopePermits(accessFor({ scope: "read" }), "write")).toBe(false);
  });

  it("allows a read to a read-only key", () => {
    expect(scopePermits(accessFor({ scope: "read" }), "read")).toBe(true);
  });

  it("allows both to a read-write key", () => {
    const rw = accessFor({ scope: "write" });

    expect(scopePermits(rw, "read")).toBe(true);
    expect(scopePermits(rw, "write")).toBe(true);
  });

  it("denies everything on an unrecognised scope value", () => {
    // Fail closed. A value we did not write is a value we cannot interpret, so
    // it must not be guessed in the permissive direction.
    for (const unknown of ["admin", "rw", "READ", "", "owner", "*"]) {
      const resolved = accessFor({ scope: unknown });

      expect(resolveKeyScope(unknown)).toBe("none");
      expect(scopePermits(resolved, "read")).toBe(false);
      expect(scopePermits(resolved, "write")).toBe(false);
    }
  });

  it("denies every domain on an unrecognised scope, even an unrestricted key", () => {
    // A missed scope check upstream must not become a domain-level bypass.
    const broken = accessFor({ scope: "nonsense" });

    expect(broken.domains).toBeNull();
    expect(accessPermitsDomain(broken, "hmd.bio")).toBe(false);
  });

  it("treats an interactive session as unrestricted", () => {
    expect(scopePermits(SESSION_ACCESS, "write")).toBe(true);
    expect(accessPermitsDomain(SESSION_ACCESS, "anything.example")).toBe(true);
    expect(domainScopeFilter(SESSION_ACCESS)).toEqual({});
  });
});

describe("the scope a request method requires", () => {
  it("treats the safe methods as reads", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get", "head", "options"]) {
      expect(requiredScopeForMethod(method)).toBe("read");
    }
  });

  it("treats every state-changing method as a write", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "delete"]) {
      expect(requiredScopeForMethod(method)).toBe("write");
    }
  });

  it("requires write scope for a method it does not recognise", () => {
    // Fail closed: an unknown verb is assumed to change state.
    for (const method of ["PROPFIND", "TRACE", "", "gett"]) {
      expect(requiredScopeForMethod(method)).toBe("write");
    }
    expect(requiredScopeForMethod(undefined)).toBe("write");
    expect(requiredScopeForMethod(null)).toBe("write");
  });

  it("refuses a write method to a read-only key end to end", () => {
    const readOnly = accessFor({ scope: "read" });

    expect(scopePermits(readOnly, requiredScopeForMethod("DELETE"))).toBe(false);
    expect(scopePermits(readOnly, requiredScopeForMethod("POST"))).toBe(false);
    expect(scopePermits(readOnly, requiredScopeForMethod("PUT"))).toBe(false);
    expect(scopePermits(readOnly, requiredScopeForMethod("PATCH"))).toBe(false);
    expect(scopePermits(readOnly, requiredScopeForMethod("GET"))).toBe(true);
  });
});

describe("expiry", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");

  it("accepts a key whose expiry is still ahead", () => {
    const result = resolveKeyAccess({ expiresAt: new Date("2026-08-09T00:00:00.000Z") }, now);

    expect(result.ok).toBe(true);
  });

  it("rejects a key whose expiry has passed", () => {
    const result = resolveKeyAccess({ expiresAt: new Date("2026-08-07T23:59:59.000Z") }, now);

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a key at the exact instant it expires", () => {
    // The boundary belongs to the expired side: a key valid "until" an instant
    // is not valid at it.
    expect(resolveKeyAccess({ expiresAt: now }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("accepts an expiry stored as an ISO string rather than a Date", () => {
    expect(resolveKeyAccess({ expiresAt: "2026-08-09T00:00:00.000Z" }, now).ok).toBe(true);
    expect(resolveKeyAccess({ expiresAt: "2026-08-01T00:00:00.000Z" }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a key whose expiry cannot be read as a date", () => {
    // Fail closed. An unreadable expiry must not resolve to "never expires".
    expect(resolveKeyAccess({ expiresAt: "not a date" }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(resolveKeyAccess({ expiresAt: Number.NaN }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects an expired key regardless of how wide its scope is", () => {
    const result = resolveKeyAccess(
      { scope: "write", expiresAt: new Date("2020-01-01T00:00:00.000Z") },
      now
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});

describe("per-domain restriction", () => {
  const restricted = accessFor({ scope: "write", domains: ["go.glasspadelapp.com"] });

  it("allows the domain the key is confined to", () => {
    expect(accessPermitsDomain(restricted, "go.glasspadelapp.com")).toBe(true);
  });

  it("denies another domain belonging to the same owner", () => {
    expect(accessPermitsDomain(restricted, "go.guden.com.tr")).toBe(false);
  });

  it("denies the primary domain too", () => {
    // A key confined to a custom domain must not fall back to hmd.bio.
    expect(accessPermitsDomain(restricted, "hmd.bio")).toBe(false);
  });

  it("allows several domains when several are listed", () => {
    const multi = accessFor({ domains: ["a.example.com", "b.example.com"] });

    expect(accessPermitsDomain(multi, "a.example.com")).toBe(true);
    expect(accessPermitsDomain(multi, "b.example.com")).toBe(true);
    expect(accessPermitsDomain(multi, "c.example.com")).toBe(false);
  });

  it("compares hostnames in canonical form", () => {
    // Both sides go through normaliseHost, so case, a port, a trailing dot or a
    // www prefix cannot be used to slip past the list or to fail against it.
    const stored = accessFor({ domains: ["GO.Example.COM."] });

    expect(accessPermitsDomain(stored, "go.example.com")).toBe(true);
    expect(accessPermitsDomain(stored, "GO.EXAMPLE.COM")).toBe(true);
    expect(accessPermitsDomain(stored, "go.example.com:443")).toBe(true);
    expect(accessPermitsDomain(stored, "www.go.example.com")).toBe(true);
  });

  it("does not treat a subdomain of a permitted domain as permitted", () => {
    // Matching is exact. A key for go.example.com has no claim on
    // other.go.example.com, which may be a different tenant's hostname.
    const stored = accessFor({ domains: ["go.example.com"] });

    expect(accessPermitsDomain(stored, "other.go.example.com")).toBe(false);
    expect(accessPermitsDomain(stored, "example.com")).toBe(false);
  });

  it("denies a domain that is missing or unreadable", () => {
    expect(accessPermitsDomain(restricted, null)).toBe(false);
    expect(accessPermitsDomain(restricted, undefined)).toBe(false);
    expect(accessPermitsDomain(restricted, "")).toBe(false);
    expect(accessPermitsDomain(restricted, "   ")).toBe(false);
  });

  it("narrows a list query to the permitted domains", () => {
    expect(domainScopeFilter(restricted)).toEqual({
      domain: { $in: ["go.glasspadelapp.com"] },
    });
  });

  it("narrows a domain listing on the hostname field instead", () => {
    expect(domainScopeFilter(restricted, "hostname")).toEqual({
      hostname: { $in: ["go.glasspadelapp.com"] },
    });
  });
});

describe("resolving a stored domain list", () => {
  it("reads absent and empty as no restriction", () => {
    // Neither expresses a restriction, and reading either as "deny everything"
    // would break any key whose array Mongoose materialised as [].
    expect(resolveKeyDomains(undefined)).toBeNull();
    expect(resolveKeyDomains(null)).toBeNull();
    expect(resolveKeyDomains([])).toBeNull();
  });

  it("denies everything when a restriction was expressed but is unusable", () => {
    // A non-empty list is a clear intent to restrict. If nothing in it survives
    // normalisation the answer is "no domains", never "all domains".
    expect(resolveKeyDomains([""])).toEqual([]);
    expect(resolveKeyDomains(["   ", "http://"])).toEqual([]);
    expect(resolveKeyDomains([42, null, {}])).toEqual([]);

    const unusable = accessFor({ domains: ["  "] });
    expect(accessPermitsDomain(unusable, "hmd.bio")).toBe(false);
    expect(domainScopeFilter(unusable)).toEqual({ domain: { $in: [] } });
  });

  it("denies everything when the stored value is not a list at all", () => {
    expect(resolveKeyDomains("hmd.bio" as unknown as string[])).toEqual([]);
  });

  it("keeps the valid entries and drops the junk from a mixed list", () => {
    expect(resolveKeyDomains(["Go.Example.com", 7, "", "b.example.com"])).toEqual([
      "go.example.com",
      "b.example.com",
    ]);
  });
});

describe("escalation", () => {
  it("cannot widen its own scope, because scope is read from storage only", () => {
    // There is no input path from a request into the resolved scope: it is a
    // pure function of the stored key. A read-only key stays read-only however
    // it asks.
    const stored: StoredKeyScoping = { scope: "read" };

    expect(accessFor(stored).scope).toBe("read");
    expect(scopePermits(accessFor(stored), "write")).toBe(false);
  });

  it("cannot reach a write even when its domain restriction would permit it", () => {
    // The two checks are independent and both must pass. Being permitted on a
    // domain is not permission to write to it.
    const readOnlyOnOneDomain = accessFor({ scope: "read", domains: ["go.example.com"] });

    expect(accessPermitsDomain(readOnlyOnOneDomain, "go.example.com")).toBe(true);
    expect(scopePermits(readOnlyOnOneDomain, "write")).toBe(false);
  });

  it("cannot reach a domain outside its list even with write scope", () => {
    const writeOnOneDomain = accessFor({ scope: "write", domains: ["go.example.com"] });

    expect(scopePermits(writeOnOneDomain, "write")).toBe(true);
    expect(accessPermitsDomain(writeOnOneDomain, "elsewhere.example.com")).toBe(false);
  });

  it("is always distinguishable from a session, so key-only endpoints can refuse it", () => {
    // Key management is refused on `via`, not on scope, so even a full-access
    // legacy key cannot mint a key and therefore cannot mint a broader one.
    expect(accessFor(LEGACY_KEY).via).toBe("api-key");
    expect(accessFor({ scope: "write" }).via).toBe("api-key");
    expect(SESSION_ACCESS.via).toBe("session");
  });

  it("carries no notion of an administrative role", () => {
    // The access context has no role field at all, so no scope value can ever
    // encode one. Administrative privilege is dropped in authenticateRequest,
    // which forces every key to run as "user".
    expect(Object.keys(accessFor(LEGACY_KEY)).sort()).toEqual([
      "domains",
      "keyId",
      "scope",
      "via",
    ]);
  });
});

describe("describing a key back to its owner", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");

  it("shows a legacy key as full access on every domain, never expiring", () => {
    expect(summariseKeyScope(LEGACY_KEY, now)).toEqual({
      scope: "write",
      domains: null,
      expiresAt: null,
      expired: false,
    });
  });

  it("shows a restricted key exactly as it is enforced", () => {
    expect(
      summariseKeyScope(
        {
          scope: "read",
          domains: ["GO.Example.com"],
          expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        },
        now
      )
    ).toEqual({
      scope: "read",
      domains: ["go.example.com"],
      expiresAt: "2026-12-01T00:00:00.000Z",
      expired: false,
    });
  });

  it("marks an expired key as expired and permitting nothing", () => {
    const summary = summariseKeyScope(
      { scope: "write", expiresAt: new Date("2026-01-01T00:00:00.000Z") },
      now
    );

    expect(summary.expired).toBe(true);
    expect(summary.scope).toBe("none");
  });

  it("does not report an unrecognised scope as usable", () => {
    expect(summariseKeyScope({ scope: "admin" }, now).scope).toBe("none");
  });
});

describe("access built by hand stays consistent with the resolver", () => {
  it("matches the resolver for the unrestricted case", () => {
    expect(accessFor(LEGACY_KEY)).toEqual(access());
  });
});

describe("backwards compatibility against the real schema", () => {
  // The decision logic above is only half the guarantee. The other half is that
  // Mongoose does not invent values for the new paths when it loads a document
  // written before they existed. A `[String]` path defaults to `[]` rather than
  // undefined unless declared `default: undefined`, and an `[]` stamped onto the
  // live key would be a restriction nobody asked for. These two run against the
  // actual User schema, no database required, so the schema cannot regress
  // without failing here.

  const LEGACY_KEY_DOCUMENT = {
    _id: "507f1f77bcf86cd799439012",
    keyHash: "0".repeat(64),
    prefix: "hmd_abcd",
    label: "live",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
  };

  it("loads a pre-scoping key with all three paths still absent", () => {
    const user = User.hydrate({
      _id: "507f1f77bcf86cd799439011",
      username: "owner",
      email: "owner@example.com",
      passwordHash: "x",
      role: "admin",
      isVerified: true,
      status: "approved",
      apiKeys: [LEGACY_KEY_DOCUMENT],
    });

    const key = user.apiKeys[0];
    expect(key.scope).toBeUndefined();
    expect(key.domains).toBeUndefined();
    expect(key.expiresAt).toBeUndefined();

    expect(resolveKeyAccess(key)).toEqual({
      ok: true,
      access: { via: "api-key", scope: "write", domains: null, keyId: null },
    });
  });

  it("does not stamp defaults onto a key when its document is written back", () => {
    const user = new User({
      username: "owner",
      email: "owner@example.com",
      passwordHash: "x",
      isVerified: true,
      status: "approved",
      apiKeys: [{ keyHash: "0".repeat(64), prefix: "hmd_abcd", label: "live" }],
    });

    const written = user.toObject().apiKeys[0];
    expect(written.scope).toBeUndefined();
    expect(written.domains).toBeUndefined();
    expect(written.expiresAt).toBeUndefined();
  });
});

describe("the creation schema", () => {
  // The backwards-compatibility surface is not only the stored document. An
  // existing client that POSTs nothing but a label must keep getting the key it
  // has always got, so these assert the defaults rather than the rejections.

  it("still accepts a bare label and grants full access", () => {
    const parsed = apiKeySchema.safeParse({ label: "existing client" });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.scope).toBe("write");
    expect(parsed.data.domains).toBeUndefined();
    expect(parsed.data.expiresAt).toBeUndefined();
  });

  it("still accepts an empty body", () => {
    expect(apiKeySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a fully scoped key", () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const parsed = apiKeySchema.safeParse({
      label: "glass",
      scope: "read",
      domains: ["go.glasspadelapp.com"],
      expiresAt,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an expiry that has already passed", () => {
    // Minting a key that is dead on arrival is a mistake, not an intent.
    const parsed = apiKeySchema.safeParse({
      label: "x",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a scope outside the two we enforce", () => {
    expect(apiKeySchema.safeParse({ label: "x", scope: "admin" }).success).toBe(false);
    expect(apiKeySchema.safeParse({ label: "x", scope: "*" }).success).toBe(false);
  });
});
