import * as Sentry from "@sentry/nextjs";

export { apiError } from "@/lib/api-response";

/**
 * Reports an unexpected error to Sentry with optional structured context.
 *
 * `context` is attached verbatim as `extra` data on the Sentry event, so it
 * must NEVER contain raw IP addresses (see Click.ts's ipRaw/ipIv scheme —
 * IPs are only ever handled hashed or AES-encrypted), session tokens, API
 * key secrets, INTERNAL_SECRET, or any other credential. Callers are
 * responsible for keeping this object to safe, non-sensitive diagnostic
 * fields (e.g. route name, keyword, status code).
 */
export function captureError(
  err: unknown,
  context?: Record<string, unknown>
): void {
  Sentry.captureException(err, { extra: context });
}
