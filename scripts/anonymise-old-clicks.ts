/**
 * Retention: clear the personal fields on clicks older than a given age, and
 * keep the anonymous analytics row.
 *
 * WHAT IT WRITES. Only `ipRaw`, `ipIv` and `userAgent`, and only to the empty
 * string. Nothing is deleted, no document is removed, and every analytics field
 * (createdAt, countryCode, browser, os, keyword, domain, referrer) is left
 * exactly as it was. The rules themselves live in src/lib/click-retention.ts;
 * this file is the operator interface to them and adds no policy of its own.
 *
 * WHY THIS AND NOT A TTL INDEX. A TTL index acts on existing documents the
 * moment it exists, so it is not a policy that starts applying later: creating
 * one deletes everything already past the period, immediately and
 * irreversibly. On the production collection a twelve-month TTL would have
 * removed 86,427 of 88,517 clicks. There is deliberately no TTL on `clicks`,
 * and this script is the mechanism instead.
 *
 * THE AGE IS ALWAYS EXPLICIT. There is no default. --age-days is required for a
 * dry run as well as a live one, because a run with the wrong age still leaves
 * nothing to restore from. `SUGGESTED_ANONYMISATION_AGE_DAYS` is printed for
 * reference and is never used as a fallback.
 *
 * RELATIONSHIP TO THE SCHEDULED JOB. `/api/internal/clicks/retention` runs this
 * same routine on a Vercel Cron schedule, taking its age from
 * `CLICK_RETENTION_DAYS` and doing nothing at all while that variable is unset.
 * Setting it is the act that switches retention on, and the first live run
 * should be preceded by a dry run of this script at the same age, so the number
 * of rows about to be rewritten is known beforehand rather than read off the
 * job's response afterwards. This script stays the operator interface: it takes
 * an explicit age, prints the target database, and supports a scoped run.
 *
 * Idempotent and resumable. It only selects rows that still hold a personal
 * value, so a re-run is a no-op for rows already done, and an interrupted run
 * resumes simply by being started again: the work already committed is not
 * repeated. Batched, so nothing loads the collection into memory.
 *
 * The target database comes solely from the path component of MONGODB_URI, and
 * a URI without one lands silently on `test`. The database name, the connection
 * host and the exact number of documents that would be rewritten are therefore
 * all printed before anything is written, and a live run additionally requires
 * --confirm.
 *
 * Usage:
 *   npx tsx scripts/anonymise-old-clicks.ts --age-days=365
 *   npx tsx scripts/anonymise-old-clicks.ts --age-days=365 --confirm
 *   npx tsx scripts/anonymise-old-clicks.ts --age-days=365 --domain=hmd.bio --keyword=abc12
 *
 * Required env vars: MONGODB_URI
 */

import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";
import { Click } from "../src/models/Click";
import {
  DEFAULT_BATCH_SIZE,
  SUGGESTED_ANONYMISATION_AGE_DAYS,
  anonymiseClicks,
  countAnonymisable,
  cutoffFromAgeDays,
  retentionFilter,
  CLICK_PERSONAL_FIELDS,
  type ClickScope,
} from "../src/lib/click-retention";

const COLLECTION = Click.collection.collectionName;
// Dry run is the default, and --dry-run is accepted so the habit built by the
// other scripts in this directory still works. Asking for both wins for the dry
// run: on a destructive-looking operation, the ambiguous case must not write.
const confirmed = process.argv.includes("--confirm");
const dryRun = !confirmed || process.argv.includes("--dry-run");

/** Reads `--name=value`. Returns null when the flag is absent. */
function flag(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? null : match.slice(prefix.length);
}

function numericFlag(name: string): number | null {
  const raw = flag(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a number, received: "${raw}"`);
  }
  return value;
}

function db(): mongoose.mongo.Db {
  const conn = mongoose.connection.db;
  if (!conn) throw new Error("No database handle; connectDB did not complete.");
  return conn;
}

/**
 * Which database, on which host, this run is about to write to. Read from the
 * live connection rather than re-parsed from the URI, so it reports where the
 * driver actually landed, including the `test` default a URI with no path
 * component silently falls back to.
 */
function target(): { database: string; host: string } {
  const conn = mongoose.connection;
  const port = conn.port ? `:${conn.port}` : "";
  return {
    database: db().databaseName,
    host: conn.host ? `${conn.host}${port}` : "(host not reported by the driver)",
  };
}

/** The scope flags, which must be given together or not at all. */
function readScope(): ClickScope | undefined {
  const domain = flag("domain");
  const keyword = flag("keyword");

  if (domain === null && keyword === null) return undefined;
  if (domain === null || keyword === null) {
    throw new Error(
      "--domain and --keyword must be given together: a keyword is only unique within a domain, " +
        "so one without the other would act on every tenant sharing that keyword."
    );
  }
  return { domain: domain.toLowerCase(), keyword };
}

async function printState(label: string, before: Date, scope?: ClickScope): Promise<void> {
  const { database, host } = target();
  const [total, pending] = await Promise.all([
    Click.countDocuments(scope ? { domain: scope.domain, keyword: scope.keyword } : {}),
    countAnonymisable({ before, scope }),
  ]);

  console.log(`\n=== ${label} ===`);
  console.log(`Database: "${database}" on ${host}.`);
  console.log(`Scope: ${scope ? `${scope.domain}/${scope.keyword}` : "every click"}.`);
  console.log(`${COLLECTION}: ${total} document(s) in scope.`);
  console.log(
    `${COLLECTION}: ${pending} document(s) older than ${before.toISOString()} still hold ` +
      `personal data and WOULD BE REWRITTEN.`
  );
}

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI env var is required");
    process.exit(1);
  }

  const ageDays = numericFlag("age-days");
  if (ageDays === null) {
    throw new Error(
      "--age-days is required, for a dry run as well as a live run. There is no default " +
        "retention age: the period is a policy decision, and a wrong one is not recoverable. " +
        `The value currently suggested in code is ${SUGGESTED_ANONYMISATION_AGE_DAYS} day(s).`
    );
  }

  const batchSize = numericFlag("batch-size") ?? DEFAULT_BATCH_SIZE;
  const scope = readScope();
  const before = cutoffFromAgeDays(ageDays);

  console.log(`Click anonymisation (${dryRun ? "DRY RUN, no writes" : "LIVE RUN"}).`);
  console.log(`Age: ${ageDays} day(s), so the cutoff is ${before.toISOString()}.`);
  console.log(`Suggested age in code: ${SUGGESTED_ANONYMISATION_AGE_DAYS} day(s).`);
  console.log(`Fields cleared: ${CLICK_PERSONAL_FIELDS.join(", ")}. Nothing is deleted.`);
  console.log(`Batch size: ${batchSize}.`);

  await connectDB();

  try {
    const { database, host } = target();

    // Named target plus --confirm, exactly as the index migration does it: a
    // dry run writes nothing so it needs no confirmation, and a live run cannot
    // rewrite the wrong database and report success.
    if (!dryRun) {
      console.log(`\nLive run confirmed for database "${database}" at ${host}.`);
    }

    await printState(dryRun ? "Plan (nothing will be written)" : "Before", before, scope);

    if (dryRun) {
      console.log(`\nFilter: ${JSON.stringify(retentionFilter({ before, scope }))}`);
      console.log(
        `\nDry run complete, nothing was written. Re-run with --confirm to apply this to ` +
          `database "${database}" at ${host}.`
      );
      return;
    }

    console.log("\nAnonymising");
    const result = await anonymiseClicks({
      before,
      scope,
      batchSize,
      onProgress: ({ batch, rewritten, total }) => {
        console.log(`  batch ${batch}: ${rewritten} rewritten (${total} so far).`);
      },
    });

    console.log(
      `\n  ${COLLECTION}: ${result.anonymised} of ${result.matched} matched document(s) ` +
        `anonymised in ${result.batches} batch(es).`
    );

    // Prove the collection actually holds no in-scope personal data any more,
    // rather than trusting that the batches were enough.
    const remaining = await countAnonymisable({ before, scope });
    if (remaining > 0) {
      throw new Error(
        `${COLLECTION}: ${remaining} document(s) older than the cutoff still hold personal ` +
          `data after the run. Retention is NOT as advertised. Re-run to resume; nothing ` +
          `already anonymised will be touched again.`
      );
    }
    console.log(`  ${COLLECTION}: verified, no click older than the cutoff holds personal data.`);

    await printState("After", before, scope);
    console.log("\nRun complete.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("\nAnonymisation FAILED:", err instanceof Error ? err.message : err);
  console.error("Nothing was deleted. Any row already anonymised stays anonymised; re-running resumes.");
  process.exit(1);
});
