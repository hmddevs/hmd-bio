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
