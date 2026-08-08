import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `DELETE /api/v1/links/{keyword}/clicks` is the self-service erasure path, so
 * these tests are about who may reach it and what it records: that erasure is
 * scoped to the caller's own link, that it cannot be triggered without an
 * unambiguous confirmation, and that every erasure leaves an entry naming
 * whether it was self-service or an administrator acting on somebody else's
 * data.
 *
 * The dependencies are mocked, including the response helpers, so the
 * assertions read as (status, body) rather than as HTTP plumbing. Ownership
 * itself is the real `requireOwnership`, since a mocked one would prove nothing
 * about scoping.
 */

const recordAudit = vi.fn();
const anonymiseClicks = vi.fn();
const deleteClicks = vi.fn();
const findOneLean = vi.fn();
const captureError = vi.fn();

let caller: { id: string; name?: string; role?: string } = { id: "owner-1", name: "glass" };
let callerAccess: { via: string; scope: string; domains: string[] | null; keyId: string | null } = {
  via: "session",
  scope: "write",
  domains: null,
  keyId: null,
};

vi.mock("@/lib/db", () => ({ connectDB: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/errors", () => ({ captureError: (...args: unknown[]) => captureError(...args) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitCaller: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-record")>("@/lib/audit-record");
  return { recordAudit: (...args: unknown[]) => recordAudit(...args), isAdministrativeAccess: actual.isAdministrativeAccess };
});
vi.mock("@/lib/click-retention", () => ({
  anonymiseClicks: (...args: unknown[]) => anonymiseClicks(...args),
  deleteClicks: (...args: unknown[]) => deleteClicks(...args),
}));
vi.mock("@/lib/api-response", () => ({
  apiSuccess: (data: unknown, status = 200) => ({ status, data }),
  apiError: (error: string, status: number) => ({ status, error }),
}));
vi.mock("@/models/Click", () => ({ Click: {} }));
// `@/lib/api-auth` imports this, which pulls in next-auth and cannot load under
// the test runner. Stubbed so the real `requireOwnership` can be imported.
vi.mock("@/lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("@/models/Link", () => ({
  Link: { findOne: () => ({ lean: () => findOneLean() }) },
}));

// requireAuth is stubbed to whatever the current test's caller is, but
// requireOwnership is the real implementation, so the ownership and
// domain-scope decisions under test are the ones the route actually makes.
vi.mock("@/lib/api-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-auth")>("@/lib/api-auth");
  return {
    ...actual,
    requireAuth: async () => ({
      ok: true,
      session: { user: caller, access: callerAccess },
    }),
  };
});

const { DELETE } = await import("@/app/api/v1/links/[keyword]/clicks/route");

function request(body: unknown, { malformed = false } = {}) {
  return {
    method: "DELETE",
    headers: new Headers(),
    nextUrl: new URL("https://hmd.bio/api/v1/links/abc12/clicks"),
    json: async () => {
      if (malformed) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as never;
}

async function erase(
  body: unknown,
  options: { malformed?: boolean } = {}
): Promise<{ status: number; data?: unknown; error?: string }> {
  return (await DELETE(request(body, options), {
    params: Promise.resolve({ keyword: "abc12" }),
  })) as unknown as { status: number; data?: unknown; error?: string };
}

const CONFIRM = "hmd.bio/abc12";

beforeEach(() => {
  recordAudit.mockReset().mockResolvedValue("written");
  captureError.mockReset();
  anonymiseClicks.mockReset().mockResolvedValue({ matched: 12, anonymised: 12, batches: 1 });
  deleteClicks.mockReset().mockResolvedValue({ deleted: 12, stoppedAtLimit: false });
  findOneLean.mockReset().mockResolvedValue({
    domain: "hmd.bio",
    keyword: "abc12",
    owner: { toString: () => "owner-1" },
  });
  caller = { id: "owner-1", name: "glass" };
  callerAccess = { via: "session", scope: "write", domains: null, keyId: null };
});

describe("DELETE /api/v1/links/{keyword}/clicks", () => {
  it("anonymises an owner's own clicks and keeps the analytics row", async () => {
    const response = await erase({ mode: "anonymise", confirm: CONFIRM });

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ mode: "anonymise", anonymised: 12, deleted: 0 });
    expect(anonymiseClicks).toHaveBeenCalledTimes(1);
    expect(anonymiseClicks.mock.calls[0][0]).toMatchObject({
      scope: { domain: "hmd.bio", keyword: "abc12" },
    });
    expect(deleteClicks).not.toHaveBeenCalled();
  });

  it("deletes outright only when deletion is asked for by name", async () => {
    const response = await erase({ mode: "delete", confirm: CONFIRM });

    expect(response.data).toMatchObject({ mode: "delete", deleted: 12, anonymised: 0 });
    expect(deleteClicks).toHaveBeenCalledWith({
      scope: { domain: "hmd.bio", keyword: "abc12" },
      maxBatches: expect.any(Number),
    });
    expect(anonymiseClicks).not.toHaveBeenCalled();
  });

  it("erases nothing when no mode is named", async () => {
    const response = await erase({ confirm: CONFIRM });

    expect(response.status).toBe(400);
    expect(anonymiseClicks).not.toHaveBeenCalled();
    expect(deleteClicks).not.toHaveBeenCalled();
  });

  it("erases nothing when the confirmation does not name this link", async () => {
    const response = await erase({ mode: "delete", confirm: "hmd.bio/some-other-link" });

    expect(response.status).toBe(400);
    expect(response.error).toContain("hmd.bio/abc12");
    expect(deleteClicks).not.toHaveBeenCalled();
  });

  it("erases nothing when the body cannot be parsed", async () => {
    const response = await erase(undefined, { malformed: true });

    expect(response.status).toBe(400);
    expect(deleteClicks).not.toHaveBeenCalled();
    expect(anonymiseClicks).not.toHaveBeenCalled();
  });

  it("refuses a caller who does not own the link, and erases nothing", async () => {
    caller = { id: "someone-else", name: "mallory" };

    const response = await erase({ mode: "delete", confirm: CONFIRM });

    expect(response.status).toBe(403);
    expect(deleteClicks).not.toHaveBeenCalled();
    expect(anonymiseClicks).not.toHaveBeenCalled();
  });

  it("answers 404 for a domain-restricted key addressing a link outside its domains", async () => {
    // Not 403: a key confined to one domain must not learn that a link exists
    // on another, which is the posture requireOwnership already enforces.
    caller = { id: "owner-1", name: "glass" };
    callerAccess = { via: "api-key", scope: "write", domains: ["glass.example"], keyId: "k1" };

    const response = await erase({ mode: "delete", confirm: CONFIRM });

    expect(response.status).toBe(404);
    expect(deleteClicks).not.toHaveBeenCalled();
  });

  it("records the self-service action when an owner erases their own clicks", async () => {
    // An erasure is irreversible whoever asks for it, so it is recorded even
    // when nobody privileged is involved: without this, a stolen write-scoped
    // key could empty an account's click logs link by link and leave nothing
    // behind. The action is deliberately not an `admin.` one.
    await erase({ mode: "anonymise", confirm: CONFIRM });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "link.click.anonymise",
      subjectType: "click",
      subjectCount: 12,
      detail: { domain: "hmd.bio", keyword: "abc12", mode: "anonymise", selfService: true },
    });
  });

  it("records the self-service delete action when an owner deletes their own clicks", async () => {
    await erase({ mode: "delete", confirm: CONFIRM });

    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "link.click.delete",
      detail: { selfService: true, deleted: 12 },
    });
  });

  it("records the entry after the erasure, and does not act on its outcome", async () => {
    // Fail-open ordering: the erasure commits first, so a lost entry cannot
    // turn work that actually happened into a reported failure. This is the
    // opposite of `admin/clicks:GET`, which fails closed because nothing has
    // been disclosed at its call site yet.
    const order: string[] = [];
    deleteClicks.mockImplementation(async () => {
      order.push("erase");
      return 12;
    });
    recordAudit.mockImplementation(async () => {
      order.push("audit");
      return "failed";
    });

    const response = await erase({ mode: "delete", confirm: CONFIRM });

    expect(order).toEqual(["erase", "audit"]);
    expect(response.status).toBe(200);
  });

  it("audits an administrator erasing somebody else's clicks", async () => {
    caller = { id: "admin-1", name: "umut", role: "admin" };

    const response = await erase({ mode: "delete", confirm: CONFIRM });

    expect(response.status).toBe(200);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "admin.click.delete",
      subjectType: "click",
      subjectCount: 12,
      detail: { domain: "hmd.bio", keyword: "abc12", owner: "owner-1", mode: "delete" },
    });
  });

  it("records the anonymisation action when an administrator anonymises instead", async () => {
    caller = { id: "admin-1", name: "umut", role: "admin" };

    await erase({ mode: "anonymise", confirm: CONFIRM });

    expect(recordAudit.mock.calls[0][0]).toMatchObject({ action: "admin.click.anonymise" });
  });

  it("records an administrator erasing their own clicks as self-service", async () => {
    // An admin is an ordinary user of their own links, and filing that under
    // `admin.` would bury real administrative access in routine activity.
    caller = { id: "owner-1", name: "umut", role: "admin" };

    await erase({ mode: "delete", confirm: CONFIRM });

    expect(recordAudit.mock.calls[0][0]).toMatchObject({
      action: "link.click.delete",
      detail: { selfService: true },
    });
  });

  it("never puts a ciphertext, IV or address into the audit entry", async () => {
    caller = { id: "admin-1", name: "umut", role: "admin" };

    await erase({ mode: "delete", confirm: CONFIRM });

    const entry = JSON.stringify(recordAudit.mock.calls[0][0]);
    expect(entry).not.toMatch(/ipRaw|ipIv|\d+\.\d+\.\d+\.\d+/);
  });
});
