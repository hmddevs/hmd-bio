# hmd.bio — CLAUDE.md

## What this is
- Live URL shortener and link analytics platform under HMD Corp. See README.md for full feature list.
- Rebuilt in 2026; live since May 2023. Public users, registered users, and admins.
- REST API at `/api/v1/` with response-format negotiation (`?format=json|xml|jsonp|text`).

## Stack
Next.js 16 (App Router, Turbopack) · TypeScript 5 strict · MongoDB Atlas via Mongoose 9 · Upstash Redis · NextAuth v5 beta · MUI v7 + Tailwind v4 · Resend · Sentry 10 · Vercel (lhr1) · pnpm

## Commands
```
pnpm dev          # dev server (Turbopack)
pnpm build        # production build + Sentry source map upload
pnpm lint         # ESLint (eslint-config-next)
npx tsc --noEmit  # typecheck (no test suite defined)
```

## Folder conventions
- `src/app/(auth)/` and `src/app/(legal)/` are route groups (shared layouts, not URL segments).
- `src/app/[keyword]/` — catch-all for short URL redirects; edge-resolved via `src/proxy.ts`.
- `src/app/api/internal/` — internal routes called by middleware only, authenticated via `INTERNAL_SECRET`.
- `src/models/` — all Mongoose schemas; no Drizzle, no Prisma.
- `scripts/` — one-off ops scripts, excluded from tsc compilation.
- `agent_docs/` — durable architecture context; load on demand.

## Invariants (must preserve)
- Never log, store, or expose raw IP addresses. Hash with `IP_HASH_SALT` for analytics; AES-encrypt with `IP_ENCRYPTION_KEY` for admin-only decryption.
- Redis (Upstash) is optional infrastructure. Every code path that uses it must degrade gracefully — core redirects must work without Redis.
- Keyword uniqueness is enforced at the DB level (unique index). App-level checks are convenience only; never rely on them as the sole guard.
- `INTERNAL_SECRET` gates all `/api/internal/` routes. Never expose or log it.
- API rate limits are per-tier (public 30 req/min, user 100 req/min). Upstash `@upstash/ratelimit` is the canonical implementation.

## Never do
- Raw MongoDB driver. Mongoose models only.
- In-memory caching as a substitute for Upstash.
- Store session tokens, raw IPs, or API key secrets in logs or error payloads.
- Add `console.log` in production paths — use Sentry for error capture.
- Bypass Cloudflare Turnstile on public endpoints without explicit approval.

## Ship cadence: careful
Live platform with auth, API keys, and IP-derived data. Treat auth, middleware, and IP-handling changes as high-risk.
