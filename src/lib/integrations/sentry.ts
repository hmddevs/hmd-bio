import type * as Sentry from "@sentry/nextjs";

/**
 * Shared Sentry configuration used by the client, server, and edge
 * runtime config files. Kept in one place so the three entry points
 * (sentry.client.config.ts, sentry.server.config.ts, sentry.edge.config.ts)
 * never drift.
 */
export const sentryConfig: Sentry.NodeOptions | Sentry.BrowserOptions = {
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
};
