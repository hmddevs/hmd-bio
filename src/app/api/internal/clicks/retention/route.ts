import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { timingSafeEqualStr } from "@/lib/utils";
import {
  DEFAULT_BATCH_SIZE,
  RETENTION_DAYS_ENV_VAR,
  anonymiseClicks,
  countAnonymisable,
  cutoffFromAgeDays,
  parseRetentionDays,
} from "@/lib/click-retention";

/**
 * Scheduled click retention: clears the personal fields on clicks older than
 * the configured age and keeps the anonymous analytics row.
 *
 * P3 asks for retention enforced automatically, and a script somebody has to
 * remember to run is not that, so this is the same routine on a timer. It adds
 * no policy of its own: the rules live in `src/lib/click-retention.ts` and this
 * route only decides whether it is allowed to run at all, and for how long.
 *
 * SETTING `CLICK_RETENTION_DAYS` IS THE ACT THAT SWITCHES RETENTION ON. Until
 * that variable holds a positive integer this job is completely inert: it
 * touches no document, invents no default, and returns success rather than an
 * error, since an unconfigured policy is a decision Umut has not taken yet and
 * not a fault to page anyone about. A missing, empty, non-numeric, zero,
 * negative or fractional value all mean the same thing, which is "do nothing".
 * That is deliberately the loosest possible trigger and the strictest possible
 * guard, because the failure it prevents (anonymising the whole collection off
 * a typo) is not recoverable.
 *
 * BEFORE THE FIRST LIVE RUN, do a dry run of
 * `scripts/anonymise-old-clicks.ts --age-days=<the same number>`, which writes
 * nothing and prints exactly how many rows would be rewritten. The count should
 * be known in advance rather than discovered from this job's response.
 *
 * Authentication matches `/api/internal/domains/recheck`: Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` and we cannot add headers of our own to
 * the scheduler's request, so the `x-internal-secret` convention used by the
 * other internal routes does not apply here. Fails closed (503) when
 * `CRON_SECRET` is absent.
 *
 * There is deliberately no TTL index on the clicks collection, and this job is
 * not a step towards one. A TTL acts on existing documents the moment it
 * exists; this rewrites three fields and deletes nothing.
 */

/**
 * The ceiling on one invocation: at `DEFAULT_BATCH_SIZE` per batch this is
 * 20,000 rows. Bounded so a first run against a large backlog cannot try to
 * rewrite the whole collection inside a single function invocation and time
 * out halfway. Stopping early costs nothing, because the filter only ever
 * selects rows that still hold personal data, so the next scheduled run
 * resumes rather than repeating work.
 */
const MAX_BATCHES_PER_RUN = 40;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const provided = request.headers.get("authorization");
  const expected = `Bearer ${cronSecret}`;
  if (!provided || !timingSafeEqualStr(provided, expected)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const retentionDays = parseRetentionDays(process.env[RETENTION_DAYS_ENV_VAR]);

  // The response body is the log. `console.log` is not allowed in a production
  // path here, and this is not an error, so reporting through `captureError`
  // would be a lie; Vercel records the response of every cron invocation, so
  // saying it plainly in the body is what makes an inert run visible.
  if (retentionDays === null) {
    return Response.json({
      success: true,
      data: {
        configured: false,
        anonymised: 0,
        message:
          `Click retention is not configured, so nothing was touched: no document was read ` +
          `for rewriting and no field was cleared. Set ${RETENTION_DAYS_ENV_VAR} to a positive ` +
          `whole number of days to switch retention on. Do a dry run of ` +
          `scripts/anonymise-old-clicks.ts at the same age first, so the number of rows the ` +
          `first live run will rewrite is known in advance.`,
      },
    });
  }

  const before = cutoffFromAgeDays(retentionDays);

  await connectDB();

  // Deliberately uncaught. A failure here is a genuine fault in a job that
  // handles personal data, and it must surface as a 5xx on the cron invocation
  // rather than be swallowed into a success that reports zero rows. Anything
  // already anonymised stays anonymised, and the next run resumes.
  const result = await anonymiseClicks({
    before,
    batchSize: DEFAULT_BATCH_SIZE,
    maxBatches: MAX_BATCHES_PER_RUN,
  });

  // What is still outstanding after this invocation. Zero on a run that caught
  // up; non-zero after a truncated run, and the number to watch if it does not
  // fall to zero over successive runs.
  const remaining = result.stoppedAtLimit ? await countAnonymisable({ before }) : 0;

  return Response.json({
    success: true,
    data: {
      configured: true,
      retentionDays,
      cutoff: before.toISOString(),
      matched: result.matched,
      anonymised: result.anonymised,
      batches: result.batches,
      stoppedAtLimit: result.stoppedAtLimit,
      remaining,
    },
  });
}
