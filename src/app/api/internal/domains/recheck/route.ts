import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Domain } from "@/models/Domain";
import { verifyDomainTxt } from "@/lib/dns-verify";
import { transition } from "@/lib/domain-state";
import { invalidateDomainStatus } from "@/lib/domain-cache";
import { captureError } from "@/lib/errors";
import { timingSafeEqualStr } from "@/lib/utils";

/**
 * Periodic re-check of active custom domains' DNS ownership record.
 *
 * Triggered by Vercel Cron (see `vercel.json`), which always calls this path
 * with GET and no custom headers of our own choosing — the `x-internal-secret`
 * convention used by other internal routes cannot reach this handler, since we
 * do not control the request Vercel's scheduler sends. Vercel instead attaches
 * `Authorization: Bearer <CRON_SECRET>` automatically whenever the reserved
 * `CRON_SECRET` env var is set on the project, so that is what this route
 * checks. Fails closed (503) if CRON_SECRET is not configured, exactly like
 * the INTERNAL_SECRET routes fail closed when that secret is absent.
 */
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

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

  const batchParam = Number(request.nextUrl.searchParams.get("batch"));
  const batch = Number.isFinite(batchParam) && batchParam > 0
    ? Math.min(Math.floor(batchParam), MAX_BATCH)
    : DEFAULT_BATCH;

  await connectDB();

  const domains = await Domain.find({ status: "active" })
    .sort({ lastCheckedAt: 1 })
    .limit(batch);

  // `checked` counts every domain we attempted, regardless of outcome, so the
  // summary always accounts for the full batch. `stillValid` and `failed` are
  // mutually exclusive outcomes of a completed DNS check; a domain that fails
  // but has not yet crossed the threshold falls into neither bucket (it is
  // still active, just one strike closer to failing), which is why the three
  // counters do not necessarily sum to `checked`.
  let checked = 0;
  let stillValid = 0;
  let failed = 0;
  let transitioned = 0;

  for (const domain of domains) {
    checked++;
    try {
      const result = await verifyDomainTxt(domain.hostname, domain.verificationToken);

      if (result.matched) {
        domain.consecutiveFailures = 0;
        domain.lastCheckedAt = new Date();
        await domain.save();
        stillValid++;
        continue;
      }

      // Persist the strike first, on its own. If the transition below were to
      // throw, the counter would otherwise only ever have been incremented in
      // memory and the domain would sit at one strike forever, never reaching
      // the threshold on any later run.
      domain.consecutiveFailures += 1;
      domain.lastCheckedAt = new Date();
      await domain.save();

      if (domain.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
        await transition(domain, "failed", {
          failureReason: "DNS verification record no longer matches",
          lastCheckedAt: new Date(),
        });
        await invalidateDomainStatus(domain.hostname);
        failed++;
        transitioned++;
      }
    } catch (err) {
      captureError(err, { route: "internal/domains/recheck", hostname: domain.hostname });
    }
  }

  return Response.json({
    success: true,
    data: { checked, stillValid, failed, transitioned },
  });
}
