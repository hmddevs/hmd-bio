import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/v1/admin/clicks` is the only route that decrypts visitors'
 * addresses, and the only caller of `recordAudit` that must fail closed. These
 * tests are about that decision alone: whether the rows leave the route when
 * the audit entry did not reach the database.
 *
 * Everything the route depends on is mocked, including the response helpers, so
 * the assertions read as (status, body) rather than as HTTP plumbing.
 */

const recordAudit = vi.fn();
const captureError = vi.fn();
const lean = vi.fn();
const countDocuments = vi.fn();

vi.mock("@/lib/db", () => ({ connectDB: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/errors", () => ({ captureError: (...args: unknown[]) => captureError(...args) }));
vi.mock("@/lib/audit", () => ({ recordAudit: (...args: unknown[]) => recordAudit(...args) }));
vi.mock("@/lib/ip", () => ({ decryptIP: () => "203.0.113.7" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitCaller: vi.fn().mockResolvedValue({ allowed: true }) }));

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi
    .fn()
    .mockResolvedValue({ ok: true, session: { user: { id: "admin-1", name: "umut", role: "admin" } } }),
}));

vi.mock("@/lib/api-response", () => ({
  apiSuccess: (data: unknown, status = 200) => ({ status, data }),
  apiError: (error: string, status: number) => ({ status, error }),
}));

vi.mock("@/models/Click", () => ({
  Click: {
    find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean }) }) }) }),
    countDocuments: () => countDocuments(),
  },
}));

vi.mock("@/models/Link", () => ({
  Link: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

const { GET } = await import("@/app/api/v1/admin/clicks/route");

/** One click whose address decrypts, which is what makes the entry mandatory. */
function clickRow() {
  return {
    _id: { toString: () => "665f1c2a9b1e4f0012ab34ce" },
    keyword: "abc12",
    domain: "hmd.bio",
    createdAt: new Date("2026-08-08T10:00:00.000Z"),
    ipRaw: "ciphertext",
    ipIv: "iv",
    countryCode: "GB",
  };
}

function request() {
  return {
    method: "GET",
    headers: new Headers(),
    nextUrl: new URL("https://hmd.bio/api/v1/admin/clicks"),
  } as never;
}

/** Loosely typed on purpose: the response helpers are mocked to plain objects. */
async function get(): Promise<{ status: number; data?: unknown; error?: string }> {
  return (await GET(request())) as unknown as { status: number; data?: unknown; error?: string };
}

beforeEach(() => {
  recordAudit.mockReset().mockResolvedValue("written");
  captureError.mockReset();
  lean.mockReset().mockResolvedValue([clickRow()]);
  countDocuments.mockReset().mockResolvedValue(1);
});

describe("GET /api/v1/admin/clicks", () => {
  it("returns the decrypted rows once the audit entry is written", async () => {
    const response = await get();

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ total: 1 });
    expect((response.data as { clicks: Array<{ ip: string }> }).clicks[0].ip).toBe("203.0.113.7");
  });

  for (const outcome of ["failed", "timed-out"] as const) {
    it(`refuses to disclose the addresses when the audit entry ${outcome}`, async () => {
      recordAudit.mockResolvedValue(outcome);

      const response = await get();

      expect(response.status).toBe(503);
      expect(response.error).toBe("Audit unavailable, refusing to disclose visitor addresses");
      expect(response.data).toBeUndefined();
      // The refusal itself is reported, and never with an address in it.
      expect(captureError).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(captureError.mock.calls[0])).not.toMatch(/203\.0\.113\.7/);
    });
  }

  it("still answers when nothing decrypted, since nothing was disclosed", async () => {
    lean.mockResolvedValue([{ ...clickRow(), ipRaw: undefined, ipIv: undefined }]);

    const response = await get();

    expect(recordAudit).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});
