import { describe, it, expect } from "vitest";
import {
  buildAuditRecord,
  isAdministrativeAccess,
  looksLikeIpAddress,
  MAX_SUBJECT_IDS,
  REDACTED,
  type AuditRecordInput,
} from "@/lib/audit-record";

function input(overrides: Partial<AuditRecordInput> = {}): AuditRecordInput {
  return {
    actorId: "665f1c2a9b1e4f0012ab34cd",
    actorUsername: "umut",
    action: "admin.click_ip.decrypt",
    subjectType: "click",
    subjectIds: ["665f1c2a9b1e4f0012ab34ce"],
    route: "admin/clicks:GET",
    method: "get",
    ...overrides,
  };
}

describe("looksLikeIpAddress", () => {
  it("recognises IPv4 addresses, bare or embedded", () => {
    expect(looksLikeIpAddress("203.0.113.7")).toBe(true);
    expect(looksLikeIpAddress("seen from 203.0.113.7 earlier")).toBe(true);
  });

  it("recognises IPv6 addresses in full and compressed form", () => {
    expect(looksLikeIpAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
    expect(looksLikeIpAddress("2001:db8::8a2e:370:7334")).toBe(true);
    expect(looksLikeIpAddress("::1")).toBe(true);
  });

  it("does not fire on values an audit entry legitimately holds", () => {
    expect(looksLikeIpAddress("admin/clicks:GET")).toBe(false);
    expect(looksLikeIpAddress("go.glasspadelapp.com")).toBe(false);
    expect(looksLikeIpAddress("665f1c2a9b1e4f0012ab34cd")).toBe(false);
    // A salted hash is 16 hex characters with no separators.
    expect(looksLikeIpAddress("a3f9c1d0e5b78246")).toBe(false);
    // Timestamps have colons but must not be mistaken for IPv6.
    expect(looksLikeIpAddress("12:34:56")).toBe(false);
    expect(looksLikeIpAddress("suspended at 09:15")).toBe(false);
  });

  it("does not fire on a dotted quad that is out of range", () => {
    expect(looksLikeIpAddress("999.999.999.999")).toBe(false);
  });
});

describe("isAdministrativeAccess", () => {
  const ADMIN = { id: "665f1c2a9b1e4f0012ab34cd", role: "admin" };
  const USER = { id: "665f1c2a9b1e4f0012ab34ce", role: "user" };

  it("counts an administrator acting on somebody else's resource", () => {
    expect(isAdministrativeAccess(ADMIN, USER.id)).toBe(true);
  });

  it("does not count an administrator editing their own link", () => {
    // An admin is still an ordinary user of their own links, and logging that
    // would bury real administrative access in their own routine activity.
    expect(isAdministrativeAccess(ADMIN, ADMIN.id)).toBe(false);
  });

  it("does not count an ordinary user editing their own link", () => {
    expect(isAdministrativeAccess(USER, USER.id)).toBe(false);
  });

  it("does not count a non-admin at all, whoever owns the resource", () => {
    // Unreachable in practice, since ownership is enforced upstream, but the
    // predicate must not be the thing that grants an entry to a non-admin.
    expect(isAdministrativeAccess(USER, ADMIN.id)).toBe(false);
    expect(isAdministrativeAccess({ id: USER.id }, null)).toBe(false);
  });

  it("counts an administrator acting on a link left with no owner", () => {
    expect(isAdministrativeAccess(ADMIN, null)).toBe(true);
  });
});

describe("buildAuditRecord", () => {
  it("keeps the fields an investigation needs", () => {
    const record = buildAuditRecord(
      input({ detail: { page: 2, filterCountry: "GB", matchingTotal: 41 } })
    );

    expect(record).toMatchObject({
      actorId: "665f1c2a9b1e4f0012ab34cd",
      actorUsername: "umut",
      action: "admin.click_ip.decrypt",
      subjectType: "click",
      subjectIds: ["665f1c2a9b1e4f0012ab34ce"],
      subjectCount: 1,
      route: "admin/clicks:GET",
      method: "GET",
      detail: { page: 2, filterCountry: "GB", matchingTotal: 41 },
    });
  });

  it("refuses an entry with no actor, because it would be unattributable", () => {
    expect(() => buildAuditRecord(input({ actorId: "  " }))).toThrow(/actor id/i);
  });

  it("refuses an unhashed address in the actor IP field", () => {
    expect(() => buildAuditRecord(input({ actorIpHash: "203.0.113.7" }))).toThrow(
      /unhashed IP/i
    );
  });

  it("accepts a salted hash in the actor IP field", () => {
    expect(buildAuditRecord(input({ actorIpHash: "a3f9c1d0e5b78246" })).actorIpHash).toBe(
      "a3f9c1d0e5b78246"
    );
  });

  it("refuses a subject reference that is itself an address", () => {
    expect(() =>
      buildAuditRecord(input({ subjectIds: ["203.0.113.7"] }))
    ).toThrow(/subject reference is an IP/i);
  });

  it("redacts an address that reaches the detail payload", () => {
    const record = buildAuditRecord(
      input({ detail: { note: "decrypted to 203.0.113.7", filterCountry: "GB" } })
    );
    expect(record.detail.note).toBe(REDACTED);
    expect(record.detail.filterCountry).toBe("GB");
  });

  it("drops nested values rather than serialising them", () => {
    const record = buildAuditRecord(
      input({ detail: { nested: { ip: "203.0.113.7" }, list: ["203.0.113.7"], ok: true } })
    );
    expect(record.detail).toEqual({ ok: true });
  });

  it("drops empty strings and non-finite numbers but keeps false, zero and null", () => {
    const record = buildAuditRecord(
      input({ detail: { blank: "  ", broken: NaN, flag: false, count: 0, reason: null } })
    );
    expect(record.detail).toEqual({ flag: false, count: 0, reason: null });
  });

  it("caps subject ids while reporting the true total", () => {
    const ids = Array.from({ length: MAX_SUBJECT_IDS + 25 }, (_, i) => `click-${i}`);
    const record = buildAuditRecord(
      input({ subjectIds: ids, subjectCount: ids.length })
    );
    expect(record.subjectIds).toHaveLength(MAX_SUBJECT_IDS);
    expect(record.subjectCount).toBe(MAX_SUBJECT_IDS + 25);
  });

  it("falls back to the number of ids when no count is declared", () => {
    expect(buildAuditRecord(input({ subjectIds: ["a", "b"] })).subjectCount).toBe(2);
  });

  it("discards blank subject ids", () => {
    expect(buildAuditRecord(input({ subjectIds: ["a", "", "  ", "b"] })).subjectIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("truncates a caller-supplied filter rather than storing it whole", () => {
    const record = buildAuditRecord(input({ detail: { filterBrowser: "x".repeat(5000) } }));
    expect(String(record.detail.filterBrowser).length).toBeLessThanOrEqual(201);
  });

  it("caps how many detail keys an entry can carry", () => {
    const detail = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, i])
    );
    expect(Object.keys(buildAuditRecord(input({ detail })).detail).length).toBeLessThanOrEqual(
      12
    );
  });

  it("tolerates a missing username, method and user agent", () => {
    const record = buildAuditRecord({
      actorId: "665f1c2a9b1e4f0012ab34cd",
      action: "admin.user.delete",
      subjectType: "user",
      route: "admin/users/[id]:DELETE",
    });
    expect(record).toMatchObject({
      actorUsername: "",
      method: "",
      actorIpHash: "",
      actorUserAgent: "",
      subjectIds: [],
      subjectCount: 0,
      detail: {},
    });
  });
});
