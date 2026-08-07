import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook. This file is what loads the Sentry SDK on the
 * server and on the edge.
 *
 * Without it, `sentry.server.config.ts` and `sentry.edge.config.ts` are never
 * imported by anything, `Sentry.init` never runs in those runtimes, and every
 * server-side `captureError` is a no-op. `next.config.ts` passes
 * `silent: true` to `withSentryConfig`, which suppresses the SDK's own warning
 * about exactly that, so the gap was invisible. Only the browser bundle was
 * initialised, via `sentry.client.config.ts`.
 *
 * `register` runs once per runtime at start-up, so each config is imported
 * behind its own `NEXT_RUNTIME` check: importing the Node config on the edge
 * would pull Node built-ins into an edge bundle.
 *
 * SCOPE, stated so nobody reads more into this file than it does. It wires the
 * SDK up; it does not switch capture on. `src/lib/integrations/sentry.ts` sets
 * `dsn: process.env.SENTRY_DSN` with `enabled: NODE_ENV === "production"`, and
 * there is currently no Sentry variable of any kind in the Vercel production
 * environment, so capture stays inert until a DSN is configured. That
 * configuration is the owner's decision and is deliberately not made here.
 * Note also that the client config needs a `NEXT_PUBLIC_`-prefixed DSN to work
 * at all: a bare `SENTRY_DSN` is not exposed to client bundles, so setting only
 * that would enable server and edge capture and leave the browser silent.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Next's request-error hook. Errors thrown while rendering or handling a
 * request never pass through our own `captureError`, so without this export
 * they are reported nowhere.
 */
export const onRequestError = Sentry.captureRequestError;
