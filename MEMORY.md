# hmd.bio — project memory

Curated, edited in place (not a log). See `./tasks/journal.md` for dated history.

## Architecture decisions
- Click.ts dropped the standalone `ip` (SHA-256 hash) field entirely; only
  `ipRaw`/`ipIv` (AES-256-GCM, admin-decryptable) are stored per click.
  `hashIP()` is now used only for rate-limit key scoping (e.g.
  `resolve:${hashIP(clientIP)}`), not for persisted per-click analytics.
- The edge Redis cache fast-path in `src/proxy.ts` (`getCachedLink`) was
  removed; every redirect now always resolves via
  `/api/internal/resolve` → MongoDB. Confirm this is deliberate before
  re-adding any Redis-based redirect cache — the old fast path and the new
  encryptIP-on-every-request code path are not both meant to exist.

## Recurring mistakes to watch for (found and fixed in this session's diff)
- Shared helper contracts (`src/lib/rate-limit.ts`, `api-response.ts`,
  `api-auth.ts`, `errors.ts`, `ip.ts`, `api-keys.ts`) were built by parallel
  agents against an agreed-but-unreviewed contract. Always re-check call
  sites after a multi-agent parallel build — one route
  (`src/app/api/v1/auth/api-keys/route.ts`) had redeclared a private
  `hashApiKey()` instead of importing the shared one from `@/lib/api-keys.ts`;
  fixed to import the shared version, matching `src/lib/auth.ts`.
- When deleting/consolidating routes (e.g. `/api/v1/user/links/**` removed
  in favour of `/api/v1/links/**`), grep every page that `fetch()`s the old
  path before deleting the route file. `src/app/dashboard/links/page.tsx`
  was left calling the deleted `/api/v1/user/links` and
  `/api/v1/user/links/{keyword}` endpoints; fixed to call `/api/v1/links`.
- Turnstile (`requireTurnstile` in `src/lib/auth.ts`) is wired into
  `/api/v1/shorten` but was missing from `/api/v1/auth/signup`, despite
  `signupSchema` accepting an optional `turnstileToken`. Public,
  account-creating endpoints need the same bot-gate as anonymous link
  creation — check this specifically on any new public POST route. Fixed.
- Crypto helpers that can throw on misconfigured env (`encryptIP` throws if
  `IP_ENCRYPTION_KEY` isn't a 64-char hex string) must be called inside a
  try/catch on any hot path that must never 500 (e.g. redirect resolution).
  `src/app/api/internal/resolve/route.ts` was calling it unguarded, outside
  any try/catch, directly in the request path; wrapped now.
