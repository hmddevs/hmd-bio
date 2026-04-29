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
