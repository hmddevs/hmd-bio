/**
 * Retention for the click log.
 *
 * Retention here means anonymisation, not deletion. A `Click` carries two kinds
 * of field: the personal ones (the encrypted visitor address, its IV, and the
 * user agent), and the anonymous analytics ones (when, from where, on what).
 * Ageing out the first while keeping the second is what data minimisation
 * actually asks for, and it is the only option that answers a privacy question
 * without destroying the product: on the production collection at the time of
 * writing, a twelve-month deletion policy would have removed 86,427 of 88,517
 * rows, and twenty-four months still removed 58% of them.
 *
 * Two callers drive this module: `scripts/anonymise-old-clicks.ts` for an
 * operator-run pass with an explicit age, and the scheduled job at
 * `/api/internal/clicks/retention`, which reads the age from
 * `CLICK_RETENTION_DAYS` and does nothing at all while that is unset.
 *
 * Deletion stays available (`deleteClicks`) as a per-customer choice for anyone
 * who wants it. It is never the default, and nothing in this module or its
 * script deletes anything unless a caller asks for deletion by name.
 *
 * Two rules this module has to hold:
 *
 * 1. Idempotency. Re-running must be a no-op for rows already anonymised. That
 *    is a property of the filter, not of a flag on the document: a row whose
 *    personal fields are already empty does not match, so it is never rewritten
 *    and never counted. This is also what makes a run safe to interrupt and
 *    resume, since progress is recorded in the documents themselves.
 * 2. Field preservation. Only `CLICK_PERSONAL_FIELDS` is ever written. Every
 *    analytics field survives, which is the entire point of choosing
 *    anonymisation over a TTL index.
 *
 * NOTE ON TTL INDEXES. There is deliberately no TTL index on this collection
 * and there must not be one added casually. MongoDB acts on existing documents
 * the moment a TTL index exists, so merging one is not a policy change that
 * takes effect later, it is an immediate irreversible delete of everything
 * already past the period.
 */

import { Click } from "@/models/Click";

/**
 * The fields cleared by anonymisation: the AES-GCM ciphertext of the visitor's
 * address, its IV, and the user agent string.
 *
 * `ipRaw` and `ipIv` are only meaningful together, so they are always cleared
 * together: half a pair is neither usable nor less personal.
 */
export const CLICK_PERSONAL_FIELDS = ["ipRaw", "ipIv", "userAgent"] as const;

/**
 * The fields anonymisation must leave untouched. Not used to build a query,
 * since anonymisation writes an allow-list rather than filtering a deny-list;
 * it is here so the guarantee is stated in code and can be asserted against.
 */
export const CLICK_ANALYTICS_FIELDS = [
  "createdAt",
  "countryCode",
  "browser",
  "os",
  "keyword",
  "domain",
  "referrer",
] as const;

/**
 * Cleared to the empty string rather than unset, matching the schema defaults
 * in `src/models/Click.ts`. An anonymised row is then indistinguishable from a
 * row recorded without an address in the first place, which is the correct
 * outcome: neither holds personal data, and the difference is not worth
 * recording per row.
 */
const ANONYMISED_VALUES: Readonly<Record<(typeof CLICK_PERSONAL_FIELDS)[number], "">> =
  Object.freeze({ ipRaw: "", ipIv: "", userAgent: "" });

/**
 * POLICY CHOICE, NOT A FACT, and deliberately not a default anywhere.
 *
 * Nothing in this module or in `scripts/anonymise-old-clicks.ts` reads this
 * value to decide what to act on; the age is always an explicit argument, so a
 * caller who forgets it gets an error rather than a silent mass rewrite. It
 * exists so the number the owner settles on has one home when it is settled,
 * and so the script can print it as a suggestion next to the age it was
 * actually given.
 */
export const SUGGESTED_ANONYMISATION_AGE_DAYS = 365;

/**
 * The environment variable that switches scheduled retention on.
 *
 * A policy number, not a secret. It is deliberately the only thing standing
 * between the scheduled job and a mass rewrite: while it is unset the job is
 * completely inert, and setting it is the act that turns retention on. See
 * `parseRetentionDays` for what counts as set.
 */
export const RETENTION_DAYS_ENV_VAR = "CLICK_RETENTION_DAYS";

/**
 * Reads the configured retention age, or `null` when retention is not
 * configured.
 *
 * `null` for unset, empty, non-numeric, zero, negative and fractional input.
 * There is no fallback to `SUGGESTED_ANONYMISATION_AGE_DAYS` and there must
 * never be one: a typo in the variable has to mean "do nothing", never "act on
 * a number nobody chose". Zero is refused for the same reason, since it would
 * anonymise the entire collection on the next tick.
 */
export function parseRetentionDays(raw: string | undefined | null): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  // `Number` rather than `parseInt`, which would read "30 days" as 30 and
  // silently accept a value whose author meant something else.
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

/** How many documents one batch rewrites. Bounded so nothing loads the collection. */
export const DEFAULT_BATCH_SIZE = 500;

/** Extra scoping for a run, e.g. one link's clicks. */
export interface ClickScope {
  domain: string;
  keyword: string;
}

export interface RetentionTarget {
  /**
   * Clicks strictly older than this instant are in scope. Required: there is no
   * default age, because every plausible default silently destroys something.
   */
  before: Date;
  /** Restrict to one link. Omitted means the whole collection. */
  scope?: ClickScope;
}

/**
 * Matches only rows that still hold at least one personal value.
 *
 * `$nin: ["", null]` rather than `$ne: ""`, because a document that never had
 * the field at all is missing rather than empty, and `$ne: ""` matches missing.
 * That difference is exactly the idempotency guarantee: with `$ne` a legacy row
 * without `userAgent` would be rewritten on every single run, for ever.
 */
export function carriesPersonalData(): Record<string, unknown> {
  return {
    $or: CLICK_PERSONAL_FIELDS.map((field) => ({ [field]: { $nin: ["", null] } })),
  };
}

/** The full filter a run acts on: old enough, in scope, and not already clean. */
export function retentionFilter(target: RetentionTarget): Record<string, unknown> {
  assertUsableDate(target.before);

  return {
    createdAt: { $lt: target.before },
    ...(target.scope ? { domain: target.scope.domain, keyword: target.scope.keyword } : {}),
    ...carriesPersonalData(),
  };
}

/** An instant `days` before `now`. Separated so the script's arithmetic is testable. */
export function cutoffFromAgeDays(days: number, now: Date = new Date()): Date {
  // Whole days, and at least one. `parseRetentionDays` already refuses zero for
  // the scheduled job, because a zero age puts the cutoff at "now" and sweeps
  // the entire collection. The same rule belongs here rather than there: this
  // is the one function both the job and the operator script go through, and
  // the script previously took its age straight from a flag, so
  // `--age-days=0`, or an unset shell variable expanding to `--age-days=`,
  // would have anonymised every click in one pass with `--confirm` on the same
  // line. A floor in the shared function cannot drift from its callers.
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(
      `Retention age must be a whole number of days, one or greater, received: ${days}`
    );
  }
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function assertUsableDate(before: unknown): asserts before is Date {
  if (!(before instanceof Date) || Number.isNaN(before.getTime())) {
    throw new Error("Retention requires a valid cutoff date; refusing to run without one.");
  }
}

/**
 * How many rows a run would rewrite. Counts what the run itself would act on,
 * rather than "how many are old", so it reads zero once a run has completed and
 * is the number safe to print before a live run.
 */
export async function countAnonymisable(target: RetentionTarget): Promise<number> {
  return Click.countDocuments(retentionFilter(target));
}

export interface AnonymisationProgress {
  /** 1-based index of the batch just written. */
  batch: number;
  /** Rows rewritten in that batch. */
  rewritten: number;
  /** Rows rewritten so far in this run. */
  total: number;
}

export interface AnonymiseOptions extends RetentionTarget {
  batchSize?: number;
  /**
   * Stop after this many batches, leaving the rest for the next run. Omitted
   * means run to completion, which is what the operator script wants.
   *
   * It exists for the scheduled job, where an unbounded loop is the difference
   * between a job and a runaway: a first live run on a large backlog would
   * otherwise try to rewrite the whole collection inside one function
   * invocation. Stopping early is safe precisely because the filter drives the
   * batching, so the next run resumes where this one stopped without repeating
   * work.
   */
  maxBatches?: number;
  onProgress?: (progress: AnonymisationProgress) => void;
}

export interface AnonymisationResult {
  /** Rows that still held personal data when the run started. */
  matched: number;
  /** Rows actually rewritten. Equals `matched` on an uninterrupted run. */
  anonymised: number;
  batches: number;
  /**
   * True when `maxBatches` ended the run with work still outstanding. Callers
   * that verify "nothing older than the cutoff still holds personal data" must
   * not treat a truncated run as a failed one.
   */
  stoppedAtLimit: boolean;
}

/** Outcome of a deletion run. `stoppedAtLimit` mirrors `AnonymisationResult`. */
export interface DeletionResult {
  deleted: number;
  stoppedAtLimit: boolean;
}

/**
 * Clears the personal fields on every in-scope click, in bounded batches.
 *
 * Batching is driven by the filter, not by an offset: each batch selects ids
 * that still match, and rewriting them removes them from the match set, so the
 * next batch selects different rows without a skip and without holding a
 * cursor. That is what makes a run resumable after an interruption, and what
 * makes a second run a no-op rather than a second rewrite.
 */
export async function anonymiseClicks(
  options: AnonymiseOptions
): Promise<AnonymisationResult> {
  const { before, scope, batchSize = DEFAULT_BATCH_SIZE, maxBatches, onProgress } = options;

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`Batch size must be a positive integer, received: ${batchSize}`);
  }
  if (maxBatches !== undefined && (!Number.isInteger(maxBatches) || maxBatches < 1)) {
    throw new Error(`Max batches must be a positive integer, received: ${maxBatches}`);
  }

  const filter = retentionFilter({ before, scope });
  const matched = await Click.countDocuments(filter);

  let anonymised = 0;
  let batches = 0;
  let stoppedAtLimit = false;

  for (;;) {
    if (maxBatches !== undefined && batches >= maxBatches) {
      // Only truncated if there is actually more to do. Checked against the
      // filter rather than against `matched`, so a run that finished exactly on
      // its last permitted batch reports completion rather than a phantom
      // remainder.
      stoppedAtLimit = (await Click.countDocuments(filter)) > 0;
      break;
    }

    const rows = await Click.find(filter).select("_id").sort({ _id: 1 }).limit(batchSize).lean();
    if (rows.length === 0) break;

    const result = await Click.updateMany(
      { _id: { $in: rows.map((row) => row._id) } },
      { $set: { ...ANONYMISED_VALUES } }
    );
    const rewritten = result.modifiedCount ?? 0;

    // Rows matched the filter but the write changed none of them, so the next
    // pass would select the same ids and loop for ever. The benign explanation
    // is a concurrent run that cleared them in between, which is why the filter
    // is re-read before failing: if they no longer match, the work is simply
    // already done. If they still match, something has made the filter and the
    // update disagree, and stopping loudly beats spinning.
    if (rewritten === 0) {
      const stillMatching = await Click.countDocuments({
        _id: { $in: rows.map((row) => row._id) },
        ...carriesPersonalData(),
      });
      if (stillMatching === 0) continue;

      throw new Error(
        `Anonymisation selected ${rows.length} click(s) but rewrote none. Stopping to avoid ` +
          `an endless loop; ${anonymised} row(s) were anonymised before this point and are ` +
          `already committed.`
      );
    }

    anonymised += rewritten;
    batches += 1;
    onProgress?.({ batch: batches, rewritten, total: anonymised });
  }

  return { matched, anonymised, batches, stoppedAtLimit };
}

/**
 * Deletes clicks outright. The per-customer alternative to anonymisation, for
 * an owner who wants the rows gone rather than emptied, and never a default.
 *
 * Unlike anonymisation this is irreversible and takes the analytics with it, so
 * it is only ever reached from a caller that has asked for deletion explicitly.
 */
export async function deleteClicks(target: {
  scope: ClickScope;
  before?: Date;
  batchSize?: number;
  /**
   * Ceiling on batches for one call. Omitted means run to completion, which is
   * what an operator script wants. A request handler must always pass one: a
   * single unbounded `deleteMany` over a very large match set can outlive the
   * invocation, and the rows it removed before that are gone while the audit
   * entry written afterwards never is. Bounding the work is what makes "every
   * erasure is recorded" true rather than merely intended.
   */
  maxBatches?: number;
}): Promise<DeletionResult> {
  const { scope, before, batchSize = DEFAULT_BATCH_SIZE, maxBatches } = target;

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`Batch size must be a positive integer, received: ${batchSize}`);
  }
  if (maxBatches !== undefined && (!Number.isInteger(maxBatches) || maxBatches < 1)) {
    throw new Error(`Max batches must be a positive integer, received: ${maxBatches}`);
  }

  const filter: Record<string, unknown> = { domain: scope.domain, keyword: scope.keyword };
  if (before !== undefined) {
    assertUsableDate(before);
    filter.createdAt = { $lt: before };
  }

  let deleted = 0;
  let batches = 0;

  for (;;) {
    if (maxBatches !== undefined && batches >= maxBatches) {
      // Work may remain. Reported rather than assumed, so a caller can re-issue
      // and a verifier does not read a truncated run as a failed one.
      return { deleted, stoppedAtLimit: (await Click.countDocuments(filter)) > 0 };
    }

    // Selecting ids first, because `deleteMany` takes no limit. Deleting the
    // rows removes them from the filter, so the next pass needs no offset and
    // an interrupted run simply resumes.
    const batch = await Click.find(filter).select("_id").limit(batchSize).lean();
    if (batch.length === 0) {
      return { deleted, stoppedAtLimit: false };
    }

    const result = await Click.deleteMany({ _id: { $in: batch.map((c) => c._id) } });
    deleted += result.deletedCount ?? 0;
    batches += 1;
  }
}
