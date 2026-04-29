# Request Journal — hmd.bio

Every meaningful request from Umut is logged here.
Source of truth for intent history. Committed to the repo.

## 2026-04-29: Admin panel edit link silently fails
- **Kind:** bug
- **Status:** shipped
- **Reported:** "I can't edit links from the admin panel"
- **Scope:** `src/lib/validations.ts`, `src/app/admin/(dashboard)/links/[keyword]/page.tsx`
- **Resolution:** `editLinkSchema.statusCode` expected a string enum but the form sent a number. `z.coerce.string().pipe(z.enum(...))` fixes it. Also added error surfacing in the Edit dialog.
- **Refs:** def2fc9, https://github.com/hmddevs/hmd-bio/pull/1
