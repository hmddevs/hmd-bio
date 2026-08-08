import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Retention has to hold two properties that a mock asserting "updateMany was
 * called" cannot show: that a second run rewrites nothing, and that the
 * analytics fields survive. Both are properties of the documents afterwards,
 * so the Click model is replaced by a small in-memory collection that actually
 * evaluates the query operators the module uses ($lt, $nin, $or, $in) and
 * actually applies the $set. The assertions then read the rows.
 */

interface Row {
  _id: string;
  domain: string;
  keyword: string;
  referrer: string;
  countryCode: string;
  browser: string;
  os: string;
  createdAt: Date;
  ipRaw?: string;
  ipIv?: string;
  userAgent?: string;
}

const rows: Row[] = [];

/** Counts every write the fake actually performed, to catch a needless rewrite. */
let writes = 0;

type Condition = Record<string, unknown>;

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
    const operators = condition as Condition;
    return Object.entries(operators).every(([operator, operand]) => {
      switch (operator) {
        case "$lt":
          return (value as Date).getTime() < (operand as Date).getTime();
        case "$nin":
          return !(operand as unknown[]).some((entry) => entry === (value ?? null));
        case "$in":
          return (operand as unknown[]).includes(value);
        default:
          throw new Error(`Unsupported operator in test double: ${operator}`);
      }
    });
  }
  return value === condition;
}

function matches(row: Row, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === "$or") {
      return (condition as Array<Record<string, unknown>>).some((branch) => matches(row, branch));
    }
    return matchesCondition((row as unknown as Record<string, unknown>)[field], condition);
  });
}

const Click = {
  async countDocuments(filter: Record<string, unknown> = {}) {
    return rows.filter((row) => matches(row, filter)).length;
  },
  find(filter: Record<string, unknown>) {
    let selection = rows
      .filter((row) => matches(row, filter))
      .sort((a, b) => a._id.localeCompare(b._id));
    const chain = {
      select: () => chain,
      sort: () => chain,
      limit(count: number) {
        selection = selection.slice(0, count);
        return chain;
      },
      async lean() {
        return selection.map((row) => ({ _id: row._id }));
      },
    };
    return chain;
  },
  async updateMany(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
    let modifiedCount = 0;
    for (const row of rows) {
      if (!matches(row, filter)) continue;
      const target = row as unknown as Record<string, unknown>;
      let changed = false;
      for (const [field, value] of Object.entries(update.$set)) {
        // MongoDB does not count a $set that changes nothing as a modification,
        // which is what makes the idempotency assertions below meaningful.
        if (target[field] === value) continue;
        target[field] = value;
        changed = true;
      }
      if (changed) {
        modifiedCount += 1;
        writes += 1;
      }
    }
    return { modifiedCount };
  },
  async deleteMany(filter: Record<string, unknown>) {
    const kept = rows.filter((row) => !matches(row, filter));
    const deletedCount = rows.length - kept.length;
    rows.splice(0, rows.length, ...kept);
    return { deletedCount };
  },
};

vi.mock("@/models/Click", () => ({ Click }));

const {
  CLICK_ANALYTICS_FIELDS,
  CLICK_PERSONAL_FIELDS,
  anonymiseClicks,
  countAnonymisable,
  cutoffFromAgeDays,
  deleteClicks,
  parseRetentionDays,
} = await import("@/lib/click-retention");

const NOW = new Date("2026-08-08T12:00:00.000Z");

function click(id: string, overrides: Partial<Row> = {}): Row {
  return {
    _id: id,
    domain: "hmd.bio",
    keyword: "abc12",
    referrer: "https://example.com/",
    countryCode: "GB",
    browser: "Safari",
    os: "macOS",
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    ipRaw: `ciphertext-${id}`,
    ipIv: `iv-${id}`,
    userAgent: "Mozilla/5.0",
    ...overrides,
  };
}

function seed(...seeded: Row[]) {
  rows.splice(0, rows.length, ...seeded);
}

beforeEach(() => {
  rows.splice(0, rows.length);
  writes = 0;
});

describe("anonymiseClicks", () => {
  it("clears the personal fields and leaves every analytics field intact", async () => {
    const before = click("1");
    seed({ ...before });

    const result = await anonymiseClicks({ before: NOW });

    expect(result).toMatchObject({ matched: 1, anonymised: 1 });
    for (const field of CLICK_PERSONAL_FIELDS) {
      expect(rows[0][field]).toBe("");
    }
    for (const field of CLICK_ANALYTICS_FIELDS) {
      expect(rows[0][field]).toEqual(before[field]);
    }
  });

  it("is a no-op on a second run, and writes nothing at all", async () => {
    seed(click("1"), click("2"));

    const first = await anonymiseClicks({ before: NOW });
    const writesAfterFirst = writes;
    const second = await anonymiseClicks({ before: NOW });

    expect(first.anonymised).toBe(2);
    expect(second).toMatchObject({ matched: 0, anonymised: 0, batches: 0 });
    expect(writes).toBe(writesAfterFirst);
  });

  it("does not rewrite a legacy row that never carried the fields", async () => {
    // `$ne: ""` would match a missing field and rewrite this row on every run,
    // for ever. The filter uses `$nin: ["", null]` precisely to avoid that.
    seed(click("1", { ipRaw: undefined, ipIv: undefined, userAgent: undefined }));

    const result = await anonymiseClicks({ before: NOW });

    expect(result).toMatchObject({ matched: 0, anonymised: 0 });
    expect(writes).toBe(0);
  });

  it("still anonymises a row holding only one personal value", async () => {
    seed(click("1", { ipRaw: "", ipIv: "", userAgent: "Mozilla/5.0" }));

    await anonymiseClicks({ before: NOW });

    expect(rows[0].userAgent).toBe("");
  });

  it("leaves clicks newer than the cutoff alone", async () => {
    seed(
      click("old", { createdAt: new Date("2024-01-01T00:00:00.000Z") }),
      click("new", { createdAt: new Date("2026-08-01T00:00:00.000Z") })
    );

    const result = await anonymiseClicks({ before: cutoffFromAgeDays(365, NOW) });

    expect(result.anonymised).toBe(1);
    expect(rows.find((row) => row._id === "new")?.ipRaw).toBe("ciphertext-new");
  });

  it("works through the collection in batches without missing a row", async () => {
    seed(...Array.from({ length: 7 }, (_, i) => click(`${i}`)));

    const result = await anonymiseClicks({ before: NOW, batchSize: 3 });

    expect(result).toMatchObject({ matched: 7, anonymised: 7, batches: 3 });
    expect(rows.every((row) => row.ipRaw === "")).toBe(true);
  });

  it("resumes an interrupted run without redoing the committed part", async () => {
    seed(...Array.from({ length: 6 }, (_, i) => click(`${i}`)));

    // Stop after the first batch, as an interruption would.
    await expect(
      anonymiseClicks({
        before: NOW,
        batchSize: 2,
        onProgress: () => {
          throw new Error("interrupted");
        },
      })
    ).rejects.toThrow("interrupted");

    const writesBeforeResume = writes;
    const resumed = await anonymiseClicks({ before: NOW, batchSize: 2 });

    expect(writesBeforeResume).toBe(2);
    expect(resumed).toMatchObject({ matched: 4, anonymised: 4 });
    expect(writes).toBe(6);
  });

  it("restricts a run to one link when a scope is given", async () => {
    seed(click("mine"), click("theirs", { domain: "glass.example", keyword: "book" }));

    await anonymiseClicks({ before: NOW, scope: { domain: "hmd.bio", keyword: "abc12" } });

    expect(rows.find((row) => row._id === "theirs")?.ipRaw).toBe("ciphertext-theirs");
  });

  it("finishes quietly when a concurrent run clears a batch first", async () => {
    seed(click("1"), click("2"));
    const original = Click.updateMany.bind(Click);
    // Stand in for another process winning the race: the rows are cleared
    // between selection and write, so this batch modifies nothing.
    const once = vi.spyOn(Click, "updateMany").mockImplementationOnce(async (filter, update) => {
      await original({ _id: { $in: rows.map((row) => row._id) } }, { $set: { ipRaw: "", ipIv: "", userAgent: "" } });
      writes = 0;
      return original(filter, update);
    });

    const result = await anonymiseClicks({ before: NOW });

    expect(result.anonymised).toBe(0);
    expect(rows.every((row) => row.ipRaw === "")).toBe(true);
    once.mockRestore();
  });

  it("refuses to run without a usable cutoff", async () => {
    seed(click("1"));

    await expect(
      anonymiseClicks({ before: new Date("not a date") })
    ).rejects.toThrow(/valid cutoff date/);
    expect(writes).toBe(0);
  });

  it("refuses a batch size that is not a positive integer", async () => {
    await expect(anonymiseClicks({ before: NOW, batchSize: 0 })).rejects.toThrow(/positive integer/);
  });
});

describe("countAnonymisable", () => {
  it("counts only the rows a run would rewrite, so it falls to zero afterwards", async () => {
    seed(click("1"), click("2", { createdAt: new Date("2026-08-07T00:00:00.000Z") }));

    expect(await countAnonymisable({ before: NOW })).toBe(2);
    await anonymiseClicks({ before: NOW });
    expect(await countAnonymisable({ before: NOW })).toBe(0);
  });
});

describe("deleteClicks", () => {
  it("removes only the scoped link's rows", async () => {
    seed(click("mine"), click("theirs", { domain: "glass.example", keyword: "book" }));

    const { deleted } = await deleteClicks({ scope: { domain: "hmd.bio", keyword: "abc12" } });

    expect(deleted).toBe(1);
    expect(rows.map((row) => row._id)).toEqual(["theirs"]);
  });

  it("honours an age cutoff when one is given", async () => {
    seed(
      click("old", { createdAt: new Date("2020-01-01T00:00:00.000Z") }),
      click("recent", { createdAt: new Date("2026-08-07T00:00:00.000Z") })
    );

    const { deleted } = await deleteClicks({
      scope: { domain: "hmd.bio", keyword: "abc12" },
      before: cutoffFromAgeDays(365, NOW),
    });

    expect(deleted).toBe(1);
    expect(rows.map((row) => row._id)).toEqual(["recent"]);
  });

  it("stops at the batch ceiling and says so, rather than running unbounded", async () => {
    // The request handler always passes a ceiling. An unbounded delete over a
    // very large match set can outlive the invocation, and the rows removed
    // before that are gone while the audit entry written afterwards never is.
    // Bounding the work is what makes "every erasure is recorded" true.
    seed(click("a"), click("b"), click("c"), click("d"));

    const first = await deleteClicks({
      scope: { domain: "hmd.bio", keyword: "abc12" },
      batchSize: 1,
      maxBatches: 2,
    });

    expect(first.deleted).toBe(2);
    expect(first.stoppedAtLimit).toBe(true);
    expect(rows).toHaveLength(2);

    const second = await deleteClicks({
      scope: { domain: "hmd.bio", keyword: "abc12" },
      batchSize: 1,
      maxBatches: 2,
    });

    expect(second.deleted).toBe(2);
    expect(second.stoppedAtLimit).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("reports a completed run as complete even when it ends on its last permitted batch", async () => {
    // A run that finishes exactly on the ceiling has nothing left, so reporting
    // it as truncated would send the caller back for work that does not exist.
    seed(click("a"), click("b"));

    const result = await deleteClicks({
      scope: { domain: "hmd.bio", keyword: "abc12" },
      batchSize: 1,
      maxBatches: 2,
    });

    expect(result.deleted).toBe(2);
    expect(result.stoppedAtLimit).toBe(false);
  });
});

describe("anonymiseClicks with a batch ceiling", () => {
  it("stops at the ceiling and leaves the rest for the next run", async () => {
    seed(click("a"), click("b"), click("c"), click("d"));

    const first = await anonymiseClicks({ before: NOW, batchSize: 1, maxBatches: 2 });

    expect(first).toMatchObject({ matched: 4, anonymised: 2, batches: 2, stoppedAtLimit: true });
    expect(await countAnonymisable({ before: NOW })).toBe(2);
  });

  it("resumes rather than repeating work on the following run", async () => {
    seed(click("a"), click("b"), click("c"), click("d"));

    await anonymiseClicks({ before: NOW, batchSize: 1, maxBatches: 2 });
    const writesAfterFirst = writes;
    const second = await anonymiseClicks({ before: NOW, batchSize: 1, maxBatches: 2 });

    expect(second).toMatchObject({ matched: 2, anonymised: 2, stoppedAtLimit: false });
    expect(writes - writesAfterFirst).toBe(2);
    expect(await countAnonymisable({ before: NOW })).toBe(0);
  });

  it("does not claim it stopped early when the last permitted batch finished the work", async () => {
    seed(click("a"), click("b"));

    const result = await anonymiseClicks({ before: NOW, batchSize: 1, maxBatches: 2 });

    expect(result).toMatchObject({ anonymised: 2, stoppedAtLimit: false });
  });

  it("refuses a ceiling that is not a positive integer", async () => {
    seed(click("a"));

    await expect(anonymiseClicks({ before: NOW, maxBatches: 0 })).rejects.toThrow(
      /positive integer/
    );
    expect(writes).toBe(0);
  });
});

describe("parseRetentionDays", () => {
  // The variable is the entire safety property of the scheduled job: while it
  // does not parse to a positive integer, the job must do nothing at all. Every
  // rejected case below therefore has to mean "off", never "fall back to a
  // number nobody chose".
  it("reads a positive whole number of days", () => {
    expect(parseRetentionDays("365")).toBe(365);
    expect(parseRetentionDays("  90  ")).toBe(90);
    expect(parseRetentionDays("1")).toBe(1);
  });

  it("treats an unset or empty variable as retention being switched off", () => {
    expect(parseRetentionDays(undefined)).toBeNull();
    expect(parseRetentionDays(null)).toBeNull();
    expect(parseRetentionDays("")).toBeNull();
    expect(parseRetentionDays("   ")).toBeNull();
  });

  it("refuses anything that is not a positive whole number, rather than guessing", () => {
    // "0" would anonymise the entire collection on the next tick, and each of
    // the rest is a typo whose most likely intended value is unknowable.
    expect(parseRetentionDays("0")).toBeNull();
    expect(parseRetentionDays("-30")).toBeNull();
    expect(parseRetentionDays("36.5")).toBeNull();
    expect(parseRetentionDays("365 days")).toBeNull();
    expect(parseRetentionDays("one year")).toBeNull();
    expect(parseRetentionDays("NaN")).toBeNull();
    expect(parseRetentionDays("Infinity")).toBeNull();
  });
});

describe("cutoffFromAgeDays", () => {
  it("counts back from now in whole days", () => {
    expect(cutoffFromAgeDays(365, NOW).toISOString()).toBe("2025-08-08T12:00:00.000Z");
  });

  it("refuses a negative age, which would act on clicks that do not exist yet", () => {
    expect(() => cutoffFromAgeDays(-1, NOW)).toThrow(/whole number of days/);
  });

  it("refuses a zero age, which would sweep the entire collection", () => {
    // The floor lives here rather than in each caller: the operator script took
    // its age straight from a flag, so `--age-days=0`, or an unset shell
    // variable expanding to an empty string, would otherwise have anonymised
    // every click in one pass.
    expect(() => cutoffFromAgeDays(0, NOW)).toThrow(/whole number of days/);
  });

  it("refuses a fractional age rather than silently truncating it", () => {
    expect(() => cutoffFromAgeDays(0.5, NOW)).toThrow(/whole number of days/);
    expect(() => cutoffFromAgeDays(365.5, NOW)).toThrow(/whole number of days/);
  });
});
