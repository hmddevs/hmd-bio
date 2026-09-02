/**
 * Cloudflare Worker entrypoint.
 *
 * Wraps the OpenNext-generated worker so a `scheduled` handler can be added.
 * OpenNext only emits `fetch`, so pointing wrangler straight at
 * `.open-next/worker.js` gives a Worker with no cron handler: any trigger
 * configured against it fires into nothing.
 *
 * These two jobs came from the `crons` block in vercel.json, which stopped
 * running the moment the Vercel account was retired. Domain rechecks and click
 * retention have not run since.
 */

import openNextWorker from "./.open-next/worker.js";

export * from "./.open-next/worker.js";

/** Canonical origin, avoiding the www and alias redirects in next.config.ts. */
const ORIGIN = "https://hmd.bio";

/** Cron expression -> request paths, mirroring vercel.json. */
const CRON_JOBS = {
  "0 4 * * *": ["/api/internal/domains/recheck"],
  "30 4 * * *": ["/api/internal/clicks/retention"],
};

/**
 * Cloudflare rejects "0" in the day-of-week field (it takes 1-7 or SUN-SAT) and
 * does not guarantee echoing an expression back in the form it was registered.
 * Normalising both sides keeps matching stable if these schedules ever move to
 * a weekday.
 */
const DOW = { "0": "SUN", "7": "SUN", "1": "MON", "2": "TUE", "3": "WED", "4": "THU", "5": "FRI", "6": "SAT" };

function normaliseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return String(expr).trim();
  f[4] = DOW[f[4]] ?? f[4].toUpperCase();
  return f.join(" ");
}

const CRON_JOBS_NORMALISED = Object.fromEntries(
  Object.entries(CRON_JOBS).map(([k, v]) => [normaliseCron(k), v]),
);

async function runJob(path, env, ctx) {
  // Both routes authenticate on `Authorization: Bearer <CRON_SECRET>` and expect
  // GET, matching what Vercel's scheduler sent, so route-side auth is unchanged.
  const request = new Request(`${ORIGIN}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
      "user-agent": "hmd-bio-cron/1.0",
    },
  });

  const response = await openNextWorker.fetch(request, env, ctx);
  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable>");
    throw new Error(`cron job ${path} failed: ${response.status} ${body.slice(0, 500)}`);
  }
  return response.status;
}

export default {
  fetch: openNextWorker.fetch,

  async scheduled(event, env, ctx) {
    const paths = CRON_JOBS_NORMALISED[normaliseCron(event.cron)];
    if (!paths) {
      console.error(JSON.stringify({ level: "error", op: "cron", msg: "no jobs mapped", cron: event.cron }));
      return;
    }
    if (!env.CRON_SECRET) {
      // Fail loudly: without it both routes return 503 and the schedule would
      // silently do nothing.
      console.error(JSON.stringify({ level: "error", op: "cron", msg: "CRON_SECRET is not set; skipping", cron: event.cron }));
      return;
    }

    const results = await Promise.allSettled(paths.map((path) => runJob(path, env, ctx)));
    results.forEach((result, i) => {
      const path = paths[i];
      if (result.status === "fulfilled") {
        console.log(JSON.stringify({ level: "info", op: "cron", cron: event.cron, path, status: result.value }));
      } else {
        console.error(JSON.stringify({ level: "error", op: "cron", cron: event.cron, path, error: String(result.reason) }));
      }
    });
  },
};
