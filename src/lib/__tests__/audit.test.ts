import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The write path is mocked out entirely: these tests are about what
// `recordAudit` guarantees to its callers (never rejects, never outlasts the
// timeout, never loses a failure silently), not about Mongoose.
const create = vi.fn();
const connect = vi.fn();
const captureError = vi.fn();

vi.mock("@/lib/db", () => ({ connectDB: () => connect() }));
vi.mock("@/models/AuditLog", () => ({ AuditLog: { create: (doc: unknown) => create(doc) } }));
vi.mock("@/lib/errors", () => ({ captureError: (...args: unknown[]) => captureError(...args) }));
vi.mock("@/lib/ip", () => ({ hashIP: () => "a3f9c1d0e5b78246" }));

const { recordAudit, AUDIT_WRITE_TIMEOUT_MS } = await import("@/lib/audit");

function options() {
  return {
    actor: { id: "665f1c2a9b1e4f0012ab34cd", name: "umut" },
    action: "admin.click_ip.decrypt" as const,
    subjectType: "click" as const,
    subjectIds: ["665f1c2a9b1e4f0012ab34ce", "665f1c2a9b1e4f0012ab34cf"],
    route: "admin/clicks:GET",
  };
}

/** The context object `captureError` was called with, for the single call made. */
function reportedContext(): Record<string, unknown> {
  expect(captureError).toHaveBeenCalledTimes(1);
  return captureError.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  create.mockReset().mockResolvedValue({});
  connect.mockReset().mockResolvedValue(undefined);
  captureError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordAudit", () => {
  it("writes the entry and reports nothing when the database is healthy", async () => {
    await recordAudit(options());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      actorId: "665f1c2a9b1e4f0012ab34cd",
      action: "admin.click_ip.decrypt",
      subjectCount: 2,
      route: "admin/clicks:GET",
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it("reports \"written\" when the entry reaches the database", async () => {
    await expect(recordAudit(options())).resolves.toBe("written");
  });

  it("reports \"timed-out\" so a caller that must not disclose without evidence can refuse", async () => {
    vi.useFakeTimers();
    create.mockReturnValue(new Promise(() => {}));

    const pending = recordAudit(options());
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_TIMEOUT_MS);
    await expect(pending).resolves.toBe("timed-out");
  });

  it("returns rather than rejecting when the write fails, and reports the loss", async () => {
    create.mockRejectedValue(new Error("not primary"));

    await expect(recordAudit(options())).resolves.toBe("failed");

    expect(reportedContext()).toMatchObject({
      stage: "audit-write",
      auditAction: "admin.click_ip.decrypt",
      actorId: "665f1c2a9b1e4f0012ab34cd",
      subjectCount: 2,
      route: "admin/clicks:GET",
    });
  });

  it("returns rather than rejecting when the entry itself is unbuildable", async () => {
    await expect(recordAudit({ ...options(), actor: { id: "  " } })).resolves.toBe("failed");

    expect(create).not.toHaveBeenCalled();
    expect(reportedContext()).toMatchObject({ stage: "audit-write" });
  });

  it("gives up on a hung write instead of stalling the caller", async () => {
    vi.useFakeTimers();
    // A connection that never answers: the shape that turns an administrative
    // action that already succeeded into a request that never returns.
    create.mockReturnValue(new Promise(() => {}));

    let settled = false;
    const pending = recordAudit(options()).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it("reports a timed-out write to Sentry, since a silent miss is unevidenced access", async () => {
    vi.useFakeTimers();
    create.mockReturnValue(new Promise(() => {}));

    const pending = recordAudit(options());
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_TIMEOUT_MS);
    await pending;

    expect(captureError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(String((captureError.mock.calls[0][0] as Error).message)).toMatch(/timed out/i);
    expect(reportedContext()).toMatchObject({
      stage: "audit-timeout",
      auditAction: "admin.click_ip.decrypt",
      actorId: "665f1c2a9b1e4f0012ab34cd",
      subjectCount: 2,
    });
  });

  it("never puts the caller-supplied detail payload into the Sentry context", async () => {
    create.mockRejectedValue(new Error("not primary"));

    await recordAudit({ ...options(), detail: { note: "seen from 203.0.113.7" } });

    expect(JSON.stringify(reportedContext())).not.toMatch(/203\.0\.113\.7/);
  });

  it("waits no longer than the write needs when the write is fast", async () => {
    vi.useFakeTimers();

    let settled = false;
    const pending = recordAudit(options()).then(() => {
      settled = true;
    });

    // No timer advance at all: a resolved write must not be held back by the
    // timeout window.
    await pending;
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
