# Request Journal — hmd.bio

Every meaningful request from Umut is logged here.
Source of truth for intent history. Committed to the repo.

## 2026-04-29: Admin panel edit link silently fails
- **Kind:** bug
- **Status:** merged
- **Reported:** "I can't edit links from the admin panel"
- **Scope:** `src/lib/validations.ts`, `src/app/admin/(dashboard)/links/[keyword]/page.tsx`
- **Resolution:** `editLinkSchema.statusCode` expected a string enum but the form sent a number. `z.coerce.string().pipe(z.enum(...))` fixes it. Also added error surfacing in the Edit dialog.
- **Refs:** def2fc9, 1bc812e, https://github.com/hmddevs/hmd-bio/pull/1

## 2026-04-29: Console cleanup — React #418 hydration mismatch
- **Kind:** bug
- **Status:** merged
- **Reported:** "A clear console log is a good thing"
- **Scope:** `src/app/layout.tsx`
- **Resolution:** Removed explicit `<head>` element from root layout; moved resource-hint links and JSON-LD script into `<body>` so React 19 / Next 16 can auto-hoist them. The manual `<head>` was competing with Next's metadata injection and triggering hydration mismatches under Cloudflare's runtime script injection. The auth-session "Load failed" error is left for separate investigation — likely a Cloudflare/Safari interaction, no clear root cause yet.
- **Refs:** 661fe33, https://github.com/hmddevs/hmd-bio/pull/2

## 2026-08-07: Custom domains API reference, then the apex-takeover risk
- **Kind:** docs, then feature planning
- **Status:** P1 done and uncommitted; P0 planned, not started
- **Reported:** "Read tasks/todo.md and do P1", then "we're asking for A,TXT,CNAME update in that case their website is going to be fully pointed to us. is there any other way?"
- **Scope:** `src/lib/openapi.ts`, `src/lib/openapi-public.ts` (deleted), `tasks/todo.md`
- **Resolution:** P1 closed. Both docs routes already imported `openapi.ts`, so `openapi-public.ts` was dead; folded its domains content in and removed it. All five domains endpoints documented against route source, which corrected the plan twice: `DELETE /domains/{hostname}` also returns 429, and `GET`/`DELETE /links/{keyword}` return 400 on an invalid `domain` param. Also found P2 2.1's premise false: the verify route returns `pointingRecord` on neither 200 nor 202, it returns `dnsRecord` and `requiredRecords` on the 202. Corrected in todo.md.
- **Follow-up:** Umut spotted that an apex add repoints the customer's whole root domain to us and can take their website offline. DNS has no path-level answer, so the fix is product: pre-flight apex-in-use lookup returning 422 with `confirmApex` override (fail open), a `go.` subdomain steer in the dashboard, and the consequence stated in `/docs`. Planned as P0 in todo.md against commit c1dd5e9.
- **Refs:** c1dd5e9 (base)

## 2026-08-07: Deeplink config layer shipped, then legacy plaintext IPs found in production
- **Kind:** feature, then data remediation
- **Status:** merged and remediated
- **Reported:** "Finish the deeplink config layer", then "Do the Housekeeping"
- **Scope:** `src/app/api/v1/domains/[hostname]/route.ts`, `src/app/dashboard/domains/page.tsx`, `src/lib/validations.ts`, `src/lib/openapi.ts`, `src/proxy.ts`, `src/lib/__tests__/`, `vitest.config.mts`, `scripts/remediate-click-ips.ts`
- **Resolution:** Config layer finished and merged as #29. The uncommitted work from three interrupted agents did not survive verification: the tests never executed (no runner, unresolvable `@/` aliases), and the dashboard carried a data-loss bug where the dialog opened blank and always sent `mode`, so saving on a configured domain reverted it to `shortener`. Fixed by widening `GET` to return the deeplink fields and loading from it. Review also caught two defects beyond the brief: `absoluteHttpUrl` stored the raw string while validating the parsed one (WHATWG strips tab/CR/LF, so one host validated and another was stored), and `internalOrigin` still derived the `INTERNAL_SECRET` origin from `request.url` on the platform branch, completing the #28 fix. First test suite in the repo: Vitest, 60 tests.
- **Follow-up:** Housekeeping on two dead schemeless links surfaced a much larger issue. 286 links and 88,379 clicks still held plaintext IPs in a legacy `ip` field, written by the YOURLS-era platform and carried in by `scripts/backfill-clicks.ts`, last written 2026-04-01 and never migrated during the rebuild. Current code was already correct (`ipRaw` holds AES-256-GCM ciphertext despite the misleading name, and API routes exclude it), so this was residue rather than an active leak. `scripts/remediate-link-ips.ts` already existed and covered links only; wrote `scripts/remediate-click-ips.ts` for the bulk, batched via `bulkWrite`. Both run: 0 plaintext fields remain, decrypt round-trip verified lossless, IVs unique across a 5,000-row sample. Note that `hashIP` is only ever used for rate-limit keys and is never persisted, so there is no `ipHash` field and no unique-visitor analytics to preserve.
- **Refs:** dfcfc23, https://github.com/hmddevs/hmd-bio/pull/29
