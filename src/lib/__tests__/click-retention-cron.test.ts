import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduled retention job at `/api/internal/clicks/retention`.
 *
 * The property under test is inertness. P3 deliberately ships the mechanism
 * without the policy, so until `CLICK_RETENTION_DAYS` holds a positive whole
 * number the job must touch nothing, invent nothing, and still report success:
 * an unconfigured policy is a decision not yet taken, not a fault. A test that
 * only asserted "anonymiseClicks was not called" would miss the worse failure,
 * so the retention module is mocked at the boundary and every entry point into
 * it is asserted untouched.
 *
 * `connectDB` is included in that: an inert run must not even open a database
 * connection, since that is the cheapest possible proof that nothing was read.
 */

const anonymiseClicks = vi.fn();
const countAnonymisable = vi.fn();
const connectDB = vi.fn();

vi.mock("@/lib/db", () => ({ connectDB: () => connectDB() }));
vi.mock("@/lib/click-retention", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/click-retention")>("@/lib/click-retention");
  return {
    ...actual,
    anonymiseClicks: (...args: unknown[]) => anonymiseClicks(...args),
    countAnonymisable: (...args: unknown[]) => countAnonymisable(...args),
  };
});
// Pulled in transitively by the retention module's Click import.
vi.mock("@/models/Click", () => ({ Click: {} }));

const { GET } = await import("@/app/api/internal/clicks/retention/route");

const CRON_SECRET = "cron-secret-value";

function request(authorization: string | null = `Bearer ${CRON_SECRET}`) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return {
    method: "GET",
    headers,
    nextUrl: new URL("https://hmd.bio/api/internal/clicks/retention"),
  } as never;
}

async function run(authorization?: string | null) {
  const response = await GET(request(authorization));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  anonymiseClicks.mockReset().mockResolvedValue({
    matched: 40,
    anonymised: 40,
    batches: 1,
    stoppedAtLimit: false,
  });
  countAnonymisable.mockReset().mockResolvedValue(0);
  connectDB.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("CLICK_RETENTION_DAYS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("scheduled click retention: authentication", () => {
  it("fails closed when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("CLICK_RETENTION_DAYS", "365");

    const { status } = await run();

    expect(status).toBe(503);
    expect(anonymiseClicks).not.toHaveBeenCalled();
  });

  it("refuses a caller without the cron secret, even once retention is configured", async () => {
    vi.stubEnv("CLICK_RETENTION_DAYS", "365");

    expect((await run(null)).status).toBe(403);
    expect((await run("Bearer wrong-secret")).status).toBe(403);
    expect(anonymiseClicks).not.toHaveBeenCalled();
  });
});

describe("scheduled click retention: inert until the period is set", () => {
  const unconfigured = ["", "   ", "0", "-30", "36.5", "365 days", "one year"];

  for (const value of unconfigured) {
    it(`touches nothing when CLICK_RETENTION_DAYS is ${JSON.stringify(value)}`, async () => {
      vi.stubEnv("CLICK_RETENTION_DAYS", value);

      const { status, body } = await run();

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.configured).toBe(false);
      expect(body.data.anonymised).toBe(0);
      expect(anonymiseClicks).not.toHaveBeenCalled();
      expect(countAnonymisable).not.toHaveBeenCalled();
      expect(connectDB).not.toHaveBeenCalled();
    });
  }

  it("touches nothing when the variable is absent altogether", async () => {
    vi.stubEnv("CLICK_RETENTION_DAYS", undefined);

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body.data.configured).toBe(false);
    expect(anonymiseClicks).not.toHaveBeenCalled();
    expect(connectDB).not.toHaveBeenCalled();
  });

  it("says plainly that retention is unconfigured and names the variable to set", async () => {
    // The response body is the log: Vercel records it for every cron
    // invocation, and an inert run has to be legible as deliberate rather than
    // read as a job that quietly did nothing.
    const { body } = await run();

    expect(body.data.message).toContain("CLICK_RETENTION_DAYS");
    expect(body.data.message).toContain("nothing was touched");
    expect(body.data.message).toContain("dry run");
  });

  it("succeeds rather than erroring, so an unset policy pages nobody", async () => {
    const { status } = await run();
    expect(status).toBe(200);
  });
});

describe("scheduled click retention: once the period is set", () => {
  it("anonymises at the configured age, in bounded batches", async () => {
    vi.stubEnv("CLICK_RETENTION_DAYS", "365");

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(connectDB).toHaveBeenCalledTimes(1);
    expect(anonymiseClicks).toHaveBeenCalledTimes(1);

    const options = anonymiseClicks.mock.calls[0][0];
    expect(options.before).toBeInstanceOf(Date);
    expect(options.maxBatches).toBeGreaterThan(0);
    expect(options.batchSize).toBeGreaterThan(0);
    // Whole-collection, never scoped: a scope here would silently exempt every
    // other link from the policy.
    expect(options.scope).toBeUndefined();

    const ageMs = Date.now() - (options.before as Date).getTime();
    expect(Math.round(ageMs / 86_400_000)).toBe(365);

    expect(body.data).toMatchObject({
      configured: true,
      retentionDays: 365,
      matched: 40,
      anonymised: 40,
      stoppedAtLimit: false,
      remaining: 0,
    });
  });

  it("reports what is left when the batch ceiling ended the run", async () => {
    vi.stubEnv("CLICK_RETENTION_DAYS", "30");
    anonymiseClicks.mockResolvedValue({
      matched: 90_000,
      anonymised: 20_000,
      batches: 40,
      stoppedAtLimit: true,
    });
    countAnonymisable.mockResolvedValue(70_000);

    const { body } = await run();

    expect(body.data).toMatchObject({
      anonymised: 20_000,
      stoppedAtLimit: true,
      remaining: 70_000,
    });
  });

  it("does not swallow a failure into a success reporting zero rows", async () => {
    vi.stubEnv("CLICK_RETENTION_DAYS", "365");
    anonymiseClicks.mockRejectedValue(new Error("clicks collection unreachable"));

    await expect(run()).rejects.toThrow(/unreachable/);
  });
});
