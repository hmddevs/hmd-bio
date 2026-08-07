# Custom domains for short links

**Goal:** users attach their own domain (e.g. `go.acme.com`), verify ownership, and create
short links on it through both the dashboard and the public API. Free, capped per user.

**Scale assumption:** ~5 domains initially, low tens at most. No provisioning queue, no
provider abstraction, no billing. Vercel Pro has no domain cap and no per-domain charge.

**Provider:** Vercel Domains REST API (`/v10/projects/{id}/domains`, `/v9/.../verify`).
TLS is issued and renewed by Vercel automatically.

---

## Design decisions (settled)

1. **`domain` is a denormalised lowercase hostname string on `Link`**, not an ObjectId ref.
   The redirect path is the hottest query in the system; a string field means resolution
   stays a single indexed `findOne({ domain, keyword })` with no join.
2. **`PRIMARY_DOMAIN` (`hmd.bio`) is a real value, not a null sentinel.** Every existing
   link is backfilled to it. Null-as-default would make the unique index semantics
   ambiguous and every query site need a fallback branch.
3. **Uniqueness becomes compound `(domain, keyword)`.** Two users may both own `/launch`
   on their own domains. The old global unique index on `keyword` is dropped.
4. **Ownership is verified by DNS TXT before the domain is ever provisioned.** A domain a
   user merely typed is never sent to Vercel.
5. **Custom domains serve short links only.** Dashboard, admin, auth and legal routes are
   redirected to the primary domain. A custom host must never render the app shell.
6. **Reserved keywords apply only on the primary domain.** `go.acme.com/admin` is the
   user's business; `hmd.bio/admin` is ours.

---

## Phase 1 — Data layer and migration (highest risk, lands alone)

- [x] 1.1 Add `src/lib/domains.ts`: `PRIMARY_DOMAIN` constant (from
      `NEXT_PUBLIC_PRIMARY_DOMAIN`, default `hmd.bio`), `normaliseHost()` (lowercase,
      strip port, strip trailing dot, strip `www.`), `isPrimaryHost()`.
- [x] 1.2 New model `src/models/Domain.ts`:
      `hostname` (unique, lowercase), `owner` (ObjectId, required, indexed),
      `status` (`pending_dns` | `verifying` | `provisioning` | `active` | `failed` |
      `suspended`), `verificationToken`, `verifiedAt`, `lastCheckedAt`, `failureReason`,
      `vercelDomainId`, `linkCount`, timestamps.
      Index `{ owner: 1, status: 1 }`.
- [x] 1.3 `Link.ts`: add `domain: { type: String, required: true, lowercase: true, trim: true,
      default: PRIMARY_DOMAIN }`. Remove `unique: true` from `keyword`. Add
      `LinkSchema.index({ domain: 1, keyword: 1 }, { unique: true })`.
- [x] 1.4 `Click.ts`: add `domain` (String, default `PRIMARY_DOMAIN`, indexed). Update the
      existing compound index(es) that start with `keyword` to lead with `domain`.
- [x] 1.5 Migration script `scripts/migrate-add-domain.ts`, idempotent, ordered:
      1. `updateMany({ domain: { $exists: false } }, { $set: { domain: PRIMARY_DOMAIN } })`
         on `links` and `clicks`.
      2. Verify zero docs remain without `domain` — abort loudly if any.
      3. Create `{ domain: 1, keyword: 1 }` unique index.
      4. Only then drop the old `keyword_1` unique index.
      Dry-run flag; prints counts before and after. Never destructive on failure.
- [x] 1.6 Confirm `autoIndex` in `src/lib/db.ts`. If enabled in production, disable it and
      make index creation explicit, so a deploy can never race the migration.

**Gate:** migration runs clean against a copy of production before Phase 2 starts.

## Phase 2 — Domain ownership: verification and provisioning

- [x] 2.1 `src/lib/vercel-domains.ts`: `addDomain()`, `removeDomain()`, `getDomainStatus()`
      against the Vercel REST API using `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID`
      (+ `VERCEL_TEAM_ID`). Typed errors, no secret ever logged.
- [x] 2.2 `src/lib/dns-verify.ts`: resolve `_hmd-verify.<hostname>` TXT via `node:dns/promises`
      and compare against the stored token in constant time.
- [x] 2.3 Hostname validation in `validations.ts` (`domainSchema`): valid public hostname,
      lowercase, no scheme/path/port, max 253 chars, at least one dot, not `hmd.bio` or any
      subdomain of it, not an IP, not a public suffix on its own.
- [x] 2.4 Blocklist of high-value hostnames that must never be attachable
      (bank/payment/major-brand shortlist) in `src/lib/domains.ts`.
- [x] 2.5 State machine transitions live in one module, `src/lib/domain-state.ts`. No route
      mutates `status` directly.

## Phase 3 — Domain API (`/api/v1/domains`)

- [x] 3.1 `GET /api/v1/domains` — list caller's domains with status and DNS instructions.
- [x] 3.2 `POST /api/v1/domains` — claim a hostname. Generates the verification token,
      writes `pending_dns`, returns the TXT record to create. Enforces the per-user cap
      (`MAX_DOMAINS_PER_USER`, default 3). Does **not** call Vercel.
- [x] 3.3 `POST /api/v1/domains/[hostname]/verify` — checks the TXT record; on success adds
      the domain to Vercel and moves to `provisioning`, then `active` once Vercel reports
      the cert is issued. Rate-limited (6/hour/user) so it can't be used as a DNS scanner.
- [x] 3.4 `DELETE /api/v1/domains/[hostname]` — removes from Vercel, then soft-deletes.
      Refuses while links exist unless `?force=true`, which reassigns nothing and instead
      returns the count so the user must decide explicitly.
- [x] 3.5 All four use `requireAuth`, `apiSuccess`/`apiError`, and honour `?format=`.
      Ownership is re-checked on every route; never trust the hostname in the path alone.

## Phase 4 — Link creation and resolution on custom domains

- [x] 4.1 `shortenSchema`, `editLinkSchema`, `bulkImportSchema`: optional `domain` field,
      defaulting to `PRIMARY_DOMAIN`.
- [x] 4.2 `POST /api/v1/shorten`: if `domain` is not primary, assert the caller owns it and
      it is `active`. Anonymous callers may only use the primary domain. Reserved-keyword
      check applies to the primary domain only.
- [x] 4.3 `shortUrl` in every response is built from the link's own domain, not a hardcoded
      base URL. Audit every construction site.
- [x] 4.4 `GET /api/v1/links` and `/links/[keyword]`: `domain` query param to disambiguate;
      responses include `domain`. Without the param, default to primary for
      backwards-compatibility.
- [x] 4.5 `proxy.ts`: read and normalise `Host`, pass it to `/api/internal/resolve`.
      On a non-primary host, redirect app routes (`/dashboard`, `/admin`, `/login`,
      `/signup`, legal pages) to the same path on the primary domain rather than rendering.
- [x] 4.6 `/api/internal/resolve`: accept `domain`, query `{ domain, keyword }`, and scope
      the click `$inc` to the same pair. Reject a domain that is not `active`.
- [x] 4.7 `src/app/[keyword]/page.tsx` fallback: same host-aware lookup, so the
      middleware-down path stays correct.
- [x] 4.8 Password flow (`/password/[keyword]`, `/api/internal/verify-password`) and stats
      preview (`/stats/[keyword]`, `keyword+`) made domain-aware.
- [x] 4.9 Redis: cache key becomes `resolve:{domain}:{keyword}`. Add a short-TTL
      `domain-status:{hostname}` cache so resolution does not hit Mongo for the domain
      record on every request. Degrade to Mongo if Redis is down.

## Phase 5 — Dashboard UI (MUI v7, per DESIGN.md)

- [x] 5.1 `/dashboard/domains` — list, add, verify, delete. Mirrors the API-keys pattern in
      `src/app/dashboard/settings/page.tsx`.
- [x] 5.2 Add-domain flow: enter hostname, receive the TXT record with a copy button and
      clear per-registrar wording, then a "Check now" button that polls verify.
- [x] 5.3 Status chips: pending, verifying, active, failed, suspended, with the failure
      reason surfaced verbatim when present.
- [x] 5.4 Domain selector on `/dashboard/links/new`, defaulting to `hmd.bio`, listing only
      the user's `active` domains. The edit form shows the link's domain as read-only text
      instead: `editLinkSchema.domain` is a lookup selector, not a move (moving a link
      between domains is explicitly out of scope per its schema comment), so a `Select`
      there would imply a choice that does not exist.
- [x] 5.5 Links table and detail pages show the full short URL including its domain, via the
      API's own `shortUrl`/`domain` fields rather than `window.location.origin`.
- [x] 5.6 Nav entry in `UserShell.tsx`.

## Phase 6 — Admin and abuse controls

- [x] 6.1 `/admin/(dashboard)/domains` — all domains, owner, status, link count, search.
      Follows the users-page pattern.
- [x] 6.2 Suspend/unsuspend. A suspended domain stops resolving immediately (cache
      invalidated) but retains its data.
- [x] 6.3 Re-verification cron (`/api/internal/domains/recheck`): re-resolves TXT records
      on a rolling basis and flags domains whose DNS has gone away. Batched.

## Phase 7 — Docs and verification

- [x] 7.1 OpenAPI spec (`src/lib/openapi-public.ts`) updated with the domains endpoints and
      the new `domain` field.
- [x] 7.2 `/docs` updated: how to attach a domain, DNS records, API examples.
- [x] 7.3 `npx tsc --noEmit` and `pnpm lint` clean.
- [x] 7.4 `security` agent review of the whole diff before any push (ownership checks,
      SSRF on hostname resolution, tenant isolation on every link query).
- [ ] 7.5 `vercel build` locally, both preview and production pipelines, per deploy gate.

---

## Risks

| Risk | Mitigation |
|---|---|
| Index migration breaks live redirects | Backfill before index swap; create new index before dropping old; idempotent script; run against a prod copy first |
| A link query missing its `domain` filter leaks across tenants | Every `Link.findOne`/`updateOne` audited in Phase 4; security review in 7.4 |
| Custom host renders the dashboard | Explicit host guard in `proxy.ts` (4.5) |
| Analytics merge across domains | `domain` added to `Click` in 1.4 |
| Domain hijack via unverified claim | TXT verification before provisioning (2.2), blocklist (2.4) |
| Vercel API token leak | Server-only module, never logged, no client exposure |

## Out of scope

Per-domain billing, provider abstraction, provisioning queue, destination-URL safe-browsing
screening, domain transfer between users, wildcard/apex-only edge cases beyond what Vercel
handles natively.
