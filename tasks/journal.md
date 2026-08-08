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

## 2026-08-07: Proving deeplinks in production, which showed they had never worked
- **Kind:** verification, then bug
- **Status:** merged and proven
- **Reported:** "prove in production", then "don't stop until all done"
- **Scope:** `src/proxy.ts`, `tasks/deeplink.md`
- **Resolution:** Ran the real customer path over the public API against `go.guden.com.tr`, a `go.` subdomain created the same day with two links. Config applied cleanly and read back correctly, and serving 404d: both association files missing and the fallback target ignored. Root cause was Vercel Authentication set to `all_except_custom_domains`, which makes every `*.vercel.app` URL answer a bare request with a 302 to the SSO login. `internalOrigin` preferred `VERCEL_URL`, `fetch` followed the redirect and returned the login page with `ok === true`, and only the JSON parse failed, so `fetchDomainConfig` returned null and the proxy read that as "ordinary shortener". Deeplink serving had therefore never worked in production since #28. Fixed in #30 by preferring the primary domain, which is exactly what the protection rule exempts, and by setting `redirect: "manual"` so a wrong origin fails as `!res.ok` instead of silently.
- **Follow-up:** Re-run after deploy passed on every layer: association files 200 as `application/json` with `nosniff`, byte-identical including deliberately irregular key order; per-platform targeting for iOS, Android and desktop; path and query forwarding composing without dropping the target's own parameters; unmatched paths hitting the fallback; and the domain's two pre-existing links untouched. Switching back to `shortener` took effect immediately. Test artefacts removed and the temporary API key revoked. Two things this cost: #29 had also routed platform hosts through `VERCEL_URL`, a latency regression on hmd.bio that the page-level database path masked (verified clicks kept recording), and previews still cannot read config, which needs the protection-bypass secret. Real-device verification remains impossible without the actual app.
- **Refs:** 63a21e8, https://github.com/hmddevs/hmd-bio/pull/30

## 2026-08-08: Path prefix, so a customer's existing /l/<code> links survive migration
- **Kind:** feature
- **Status:** merged and proven
- **Reported:** "Make sure we're ready to onboard GLASS", then "continue with the P0 fix round"
- **Scope:** `src/proxy.ts`, `src/lib/reserved-paths.ts` (new), `src/lib/deeplink.ts`, `src/app/[...keyword]/page.tsx` (replaces `[keyword]`), `src/lib/validations.ts`, `src/lib/utils.ts`, `.github/workflows/ci.yml`
- **Resolution:** P0 of the Glass readiness plan. Their codes live at `/l/<code>` and we resolved only at the root, so those links 404ed. Added a per-domain `pathPrefix`, strictly additive. The single-segment route became a catch-all so prefixed links keep the database-direct degradation path that root links have, which mattered because that fallback is the only reason nobody noticed the internal fetch was broken from #28 until #30.
- **Follow-up:** Two review rounds each found real defects, and the second blocked the ship. The matcher's exclusion list is a raw string prefix test rather than a segment test, so `pathPrefix: "icons"` would have skipped the middleware, bypassed the limiter and made the outage-only fallback the tenant's primary path with two unmetered writes per request. The same behaviour was already reachable with no new code: anyone could mint keyword `iconoclast` for a permanently unmetered redirect with click inflation, because the fallback page had no limiter at all. Both closed, plus bulk import and keyword generation, after checking production found zero affected links. CI ran lint and typecheck only, so the test pinning the matcher against the reserved list was a guard nothing executed; CI now runs the suite. The edge and fallback prefix checks were separate implementations that already disagreed on a trailing slash; now one shared predicate with an agreement table. Generating the matcher from the list was attempted and proven impossible by a real Turbopack build failure, so equivalence is test-enforced instead.
- **Refs:** 4565fe4, https://github.com/hmddevs/hmd-bio/pull/32

## 2026-08-08: Glass readiness, P1 through P3, and a dead error-capture path
- **Kind:** feature
- **Status:** merged and live
- **Reported:** "Do not stop until Glass can be onboardable", resumed after the previous session hit its usage limit mid-flight with P1 uncommitted in the tree
- **Scope:** `src/lib/api-key-scope.ts` (new), `src/lib/rate-limit.ts`, `src/lib/auth.ts`, `src/lib/api-auth.ts`, ~20 routes under `src/app/api/v1/`, `src/lib/audit.ts`, `src/lib/audit-record.ts`, `src/models/AuditLog.ts`, `src/lib/click-retention.ts` (new), `src/instrumentation.ts` (new), `scripts/migrate-audit-log-indexes.ts` and `scripts/anonymise-old-clicks.ts` (new), `vercel.json`
- **Resolution:** Four PRs. #36 scoped API keys: a key carried its owner's full authority, so an administrator's key passed every `role !== "admin"` gate and reached `decryptIP`, the only decryption site in the codebase, plus the admin-wide export. Keys are now pinned to `role: "user"` at authentication time, which disarms eight downstream gates at one site, and scope is derived from the request method in `authenticateRequest` rather than per-route, so a new route cannot forget it. Nested rate-limit buckets isolate a key at half the account ceiling without raising the total, inner checked before outer so a throttled key does not burn the account's allowance. #37 restored link titles in the admin clicks view, keyed with a NUL byte and read with a space so no entry ever matched; removing the NULs also made the file diffable again, having rendered as `Bin 3768 -> 4312 bytes` and hidden its own decrypt path from review. #38 landed the audit log. #40 made retention anonymisation rather than deletion.
- **Follow-up:** Review earned its keep three times. The audit log's 400-day TTL was inert, because `autoIndex: false` means a declared `Schema.index()` never exists in production, so the retention control a DPA would rest on was advertised and absent; the migration ran against production on an empty collection and verified 34,560,000s. The clicks route failed open on the audit write, correct for a write path where the action has already committed but wrong on a read where nothing has been disclosed yet, so it now returns 503 and no rows. Self-service erasure ran unbounded, which would have left rows destroyed with the audit entry never reached. And the largest finding was not in any diff: there was no instrumentation file, so `Sentry.init` never ran server-side and every `captureError` in the application had always been discarded, with the SDK's own warning suppressed by `silent: true`. Code half fixed; no DSN is configured, so capture stays off by Umut's decision, which is why the clicks route was made to fail closed rather than lean on a report that goes nowhere. P3's design was changed before any code: a twelve-month deletion TTL would have destroyed 86,427 of 88,517 clicks, so retention ages out the personal fields and keeps the anonymous row, and no TTL index is created since one would act on existing documents the moment it exists.
- **Refs:** b385092, c120de0, 7b1557e, 6ec84f5, PRs #36, #37, #38, #40, #39; #35 closed and superseded by #38
