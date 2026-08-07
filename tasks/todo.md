# Custom domains: remaining work

The feature is live and working. Links resolve, domains verify, the dashboard shows both
DNS records, Turnstile is enforced. What follows is what is genuinely NOT done.

The completed build plan is in git history (PRs #10, #11, #12). This file now tracks only
what is left.

Ordered by whether it misleads a user, then by risk.

---

## P0: An apex add can take the customer's own website offline

Planned at: commit c1dd5e9, 2026-08-07

**Scope.** `vercelPointingRecord()` returns an A record at `@` for an apex hostname. A
customer who adds `acme.com` and follows our instructions repoints their root domain to
us, and whatever website lived there disappears. We currently give no warning at all: the
`/docs` page explains the mechanics correctly but never states the consequence. This
section adds a pre-flight check that catches the dangerous case, makes the safe subdomain
the path of least resistance in the dashboard, and says the quiet part out loud in the
docs.

Ranked above the finished P1 because this is the only open item that can cause a customer
active harm rather than merely mislead them. P2 to P5 are unchanged and still sit below.

### Design decisions taken during planning

**Confirm, do not block.** An apex is legitimate when the domain was bought purely to be a
short domain, which is exactly what `hmd.bio` is. We cannot reliably tell a dedicated short
domain that happens to have a parking page from a live marketing site, and the customer may
be mid-migration. Blocking would break a real use case to prevent a hypothetical one. So a
positive lookup returns a refusal the caller can override by re-sending with
`confirmApex: true`.

**422, not 409.** 409 already means "this domain is already claimed" on this route, and
overloading it would make the two indistinguishable to a client. 422 Unprocessable Content
carries a machine-readable `code: "apex_in_use"` plus the evidence that triggered it. (428
Precondition Required was considered and rejected: it is specified for conditional-request
lost-update protection, not for user confirmation.)

**Fail open, always.** A resolver timeout, SERVFAIL, or any error means we allow the add.
Only a positive answer containing real A/AAAA/CNAME records triggers the 422. Our DNS being
slow must never block a legitimate customer.

**What counts as "in use".** Only A, AAAA or CNAME at the apex, because only those mean a
web server answers. An apex with just MX, NS, SOA or TXT has email or delegation but no
website, and must not trigger the warning. An apex already pointing at `VERCEL_APEX_IP` is
someone re-adding a domain that is already ours, and must not trigger it either.

## Plan

Sequential throughout; each task depends on the shape the previous one settles. `backend`
takes P0.1 and P0.2 (the lib helper, then the route wiring), because P0.2 cannot be written
until the helper's return type exists. `backend` also takes P0.4, since documenting the 422
requires P0.2's final response shape. `frontend` takes P0.3 and P0.5, which are the
dashboard affordance and the docs copy. P0.5 is the one genuinely independent task and can
be pulled forward if convenient.

`security` reviews before commit rather than after: P0.1 makes the server perform DNS
lookups against a hostname the caller supplies, which is a mild request-forgery surface and
a DNS-lookup oracle. The route's existing per-user rate limit is the mitigation, and the
review needs to confirm it actually covers the new code path.

`reviewer` then runs over the whole change, since it spans lib, route, two UI surfaces and
the spec.

Tasks below are grouped by specialist, so the numbers do not read in execution order.
Execute P0.1, P0.2, P0.4, P0.3, P0.5, then P0.6 and P0.7. P0.3 must not start before P0.2
has settled the 422 body, or the dashboard will be built against a guess.

## Tasks

### backend

- [ ] P0.1 Add `apexResolvesToSite(hostname)` to `src/lib/domains.ts`. Reuse the
      `createResolver()` pattern from `src/lib/dns-verify.ts:36` (pinned 1.1.1.1/8.8.8.8,
      explicit timeout, 2 tries); do not construct a bare `Resolver` or use the platform
      default. Query A, AAAA and CNAME only. Return a discriminated result carrying whether
      the apex is in use and the records found, so the route can put the evidence in the
      response. Treat every resolver error as "not in use". Return "not in use" when the
      only A record is `VERCEL_APEX_IP`.
      **Done:** `npx tsc --noEmit` exits 0, and `grep -n "new Resolver" src/lib/domains.ts`
      returns nothing (the shared helper is used, not a fresh one).
      **Stop if:** `createResolver` is not exported from `dns-verify.ts`. Export it as part
      of this task rather than duplicating the resolver configuration, but say so in the
      report.

- [ ] P0.2 Wire the check into `POST /api/v1/domains`
      (`src/app/api/v1/domains/route.ts`). Add an optional `confirmApex: boolean` to
      `domainSchema` in `src/lib/validations.ts`. After validation and the ownership-limit
      check but before `Domain.create`, when `isApexDomain(hostname)` and not
      `confirmApex`, call P0.1 and return 422 with
      `{ code: "apex_in_use", records: [...] }` and a message naming the safe alternative
      (`go.<hostname>`). Run the lookup only for an apex, never for a subdomain, so the
      common path costs nothing.
      **Done:** `npx tsc --noEmit` and `pnpm lint` both exit 0. A POST of
      `{"hostname":"google.com"}` returns 422 with `code: "apex_in_use"`; the same body
      with `"confirmApex":true` proceeds past the check; a subdomain body performs no DNS
      lookup.
      **Stop if:** the lookup adds more than roughly a second to the p50 add. The resolver
      timeout must be low enough that a dead nameserver cannot hold the request open, and
      if the existing `LOOKUP_TIMEOUT_MS` is too generous for a synchronous request path,
      report rather than silently picking a new value.

- [ ] P0.4 Document the 422 in `src/lib/openapi.ts`: the new status on
      `POST /api/v1/domains`, the `confirmApex` request field, and the `code`/`records`
      response shape. Add the consequence of the apex A record to the `pointingRecord` and
      `Domain` descriptions, so a developer reading only the spec learns it too.
      **Done:** `npx tsc --noEmit` exits 0, and loading the spec shows 422 present on
      `POST /api/v1/domains` alongside the existing 201, 400, 401, 403, 409 and 429.

### frontend

- [ ] P0.3 Dashboard parity for the 422, in `src/app/dashboard/domains/page.tsx`
      (`handleAdd` at line 243). On a 422 with `code: "apex_in_use"`, do not show the
      generic `addError` alert. Show the consequence in plain words, offer
      `go.<hostname>` as a one-click alternative, and offer a distinct confirm action that
      re-POSTs with `confirmApex: true`. The destructive option must not be the visually
      prominent one.
      Also add the subdomain steer to the field itself: when the typed value is a bare
      apex, show an inline suggestion beneath it offering `go.<domain>`, applied on click.
      Do not silently rewrite what the user typed.
      **Done:** `pnpm lint` and `npx tsc --noEmit` exit 0. Typing `example.com` surfaces the
      `go.example.com` suggestion; submitting an in-use apex surfaces the consequence and
      both choices; taking the confirm action creates the domain.
      **Stop if:** `isApexDomain` cannot be imported into a client component without
      dragging the public-suffix list into the bundle. If it is large, report before
      shipping it clientside; the suggestion can fall back to a server round trip.

- [ ] P0.5 State the consequence in `src/app/docs/page.tsx:34`. The existing text explains
      A versus CNAME correctly and stops there. Add that an A record at the apex sends the
      entire domain to us and replaces any website on it, that a subdomain such as
      `go.example.com` is the recommended choice, and that an apex is appropriate for a
      domain dedicated to short links.
      **Done:** `grep -c "" src/app/docs/page.tsx` still parses and `pnpm lint` exits 0.
      The apex consequence appears in the docs copy.

### review

- [ ] P0.6 `security` review before commit, scoped to the new DNS lookup: confirm the
      per-user rate limit on `domains-create` covers the P0.2 path, and that a caller
      cannot use the endpoint as an unmetered DNS oracle or to probe internal names.
      **Done:** a written verdict with no unresolved high findings.

- [ ] P0.7 `reviewer` over the full diff, then `/ship` (lint, typecheck).
      **Done:** `npx tsc --noEmit` and `pnpm lint` exit 0 on the final tree.

---

## P1: The API reference does not know custom domains exist (SHIPPED, PR #14)

Resolved 2026-08-07. Both `/api/docs` and `/api/admin/docs` import `openApiSpec` from
`src/lib/openapi.ts`; `openapi-public.ts` was imported by nothing. Took option (a): folded
the domains content in, deleted `openapi-public.ts`. All five endpoints documented with
status codes verified against route source, `pointingRecord` on the `Domain` schema, the
export CSV column reorder flagged as breaking, and the list-vs-single `?domain=` asymmetry
spelled out per parameter. `tsc` and `lint` clean. Not committed.

Source disagreed with the plan in two places: `DELETE /domains/{hostname}` also returns
429 (rate-limited), and `GET`/`DELETE /links/{keyword}` return 400 on an invalid `domain`
param. Both now documented.

**The miss:** `src/lib/openapi.ts` is the spec served at `/api/docs` and `/api/admin/docs`.
It contains zero mention of `/api/v1/domains`. The domains documentation written during
the build went into `src/lib/openapi-public.ts`, which is imported by nothing and reaches
no user. Neither spec mentions `pointingRecord`.

Consequence: a developer reading the formal API reference cannot discover the domains
endpoints at all, and cannot see the `domain` field on the endpoints they can find.

- [x] 1.1 Decide the fate of the two spec files, then act on it. Options:
      (a) fold the domains content from `openapi-public.ts` into `openapi.ts` and delete
          `openapi-public.ts`;
      (b) wire `openapi-public.ts` to `/api/docs` and keep `openapi.ts` for
          `/api/admin/docs` only, if the split was deliberate.
      Check git history and `src/app/api/admin/docs/route.ts` before choosing. (a) is
      likely right unless the split was intentional. RESOLVE THIS FIRST, everything below
      depends on which file is canonical.
- [x] 1.2 In the canonical spec, document all five domains endpoints: GET and POST
      `/api/v1/domains`, GET and DELETE `/api/v1/domains/{hostname}`, POST
      `/api/v1/domains/{hostname}/verify`. Include every status the routes actually
      return, verified against the source rather than assumed:
      - GET /domains: 200, 401, 429
      - POST /domains: 201, 400, 401, 403, 409, 429
      - GET /domains/{hostname}: 200, 400, 401, 404, 429
      - DELETE /domains/{hostname}: 200, 400, 401, 404, 409, 502, 503
      - POST /domains/{hostname}/verify: 200, 202, 400, 401, 403, 404, 409, 429, 503
- [x] 1.3 Add `pointingRecord` to the `Domain` schema and to every response that returns
      it. Document that it is null once a domain is active.
- [x] 1.4 Confirm the spec covers the rest of today's changes: `domain` on POST
      `/api/v1/shorten` and in link responses, `?domain=` on `/api/v1/links` and
      `/api/v1/links/{keyword}`, `shortUrl` in link responses, and the `domain` column now
      leading the `/api/v1/links/export` CSV (a breaking change for positional parsers,
      call it out explicitly).
- [x] 1.5 Document the asymmetry that will trip people up: omitting `?domain=` on the
      links LIST returns links across all the caller's domains, but omitting it on a
      single link defaults to the primary domain only.

## P1.5: Fallout from the Turnstile identity gate (SHIPPED, PR #13)

`/api/v1/shorten` ran Turnstile before `authenticateRequest`, so the CAPTCHA gated logged-in
dashboard users and API-key clients as well as anonymous ones. The dashboard new-link page
returned 403 and the whole write API was unusable. Fixed by resolving identity first and
requiring Turnstile only when the caller is anonymous, plus per-user rate limiting at the
authenticated tier to match every other `/api/v1` route. Security review found no bypass,
but flagged two consequences of the reorder.

- [x] 1.5a Ran `scripts/migrate-api-key-index.ts` against production on 2026-08-07. The
      `apiKeys.keyHash` index now exists and the script verified the key-hash lookup plans
      as an IXSCAN rather than a collection scan. Ran before the code shipped, so the scan
      vector never existed in production.
- [ ] 1.5b Session revocation does not exist. `authenticateRequest`'s session branch trusts
      the JWT for its full 7-day life and never re-reads `isVerified`/`status`, while the
      API-key branch does re-check. A user disabled after signing in keeps a working cookie,
      and that cookie is now also a CAPTCHA-free write path. Pre-existing, but the Turnstile
      change promotes it from an authorisation gap to an anti-abuse bypass. Fix in the `jwt`
      callback or in the session branch of `authenticateRequest`.
- [ ] 1.5c Consider an explicit origin check on `POST /api/v1/shorten`. The Turnstile token
      was incidentally acting as CSRF protection for session callers and no longer does.
      Not currently exploitable: NextAuth v5 defaults the cookie to `SameSite=Lax` and
      nothing overrides it, so cross-site POSTs are already blocked. Belt-and-braces only.

## P0.5: Admin authorisation weaknesses (found 2026-08-07, NOT fixed)

Surfaced by the security review of the P5.3 fix. All pre-existing, none introduced by that
change, but the review was asked to confirm the authorisation and these are what it found.
Ranked here because the first one is a live privilege-retention hole.

- [ ] 0.5a HIGH. Admin role is a JWT snapshot, so demoting an admin does not revoke their
      access. `src/lib/auth.ts:55-58` sets `token.role` only at sign-in and the session
      callback copies it verbatim, so the admin gate trusts a role that can be up to seven
      days stale. `PATCH { action: "demote" }` writes the database and nothing else, so a
      demoted admin keeps user-deletion capability for the remaining life of their token.
      Fix by re-reading role and status from the database in the admin gate, or by adding a
      role epoch to the JWT and invalidating on demote. Same class as 1.5b; fixing session
      freshness once would close both.
- [ ] 0.5b MEDIUM. `DELETE /api/v1/admin/users/{id}` accepts Bearer API keys
      (`requireAuth(request)`) while `PATCH` on the same route does not (`requireAuth()`).
      The destructive verb has the broader auth surface: a leaked admin API key can delete
      accounts but cannot approve one. Restrict deletion to session auth.
- [ ] 0.5c LOW. `DELETE` omits the `ObjectId.isValid(id)` guard that `PATCH` has, so a
      malformed id throws a CastError and returns 500 plus a Sentry event instead of 400.
      Noise, not a vulnerability.
- [ ] 0.5d LOW, product decision. An admin can delete another admin; only self-deletion is
      blocked. Combined with 0.5a this is the lateral-movement path. Umut's call whether
      that is intended.

## P2: Inconsistent API responses

- [ ] 2.1 `POST /api/v1/domains/{hostname}/verify` and `pointingRecord`. NOTE: the premise
      as originally written is wrong. Checked the source while doing P1: the route's
      `present()` helper returns `pointingRecord` on NEITHER 200 nor 202. The 202 does
      return `dnsRecord` (the TXT ownership record) and `requiredRecords` from Vercel. So
      the real question is whether 202 should also carry `pointingRecord` alongside those,
      which is a smaller change than the item implies. The spec currently documents what
      the route actually returns, so it is accurate either way.
- [ ] 2.2 `/api/v1/shorten` never passes `request` to `apiSuccess`/`apiError`, so
      `?format=json|xml|jsonp|text` is silently ignored on the single most-used endpoint
      in the API. Fix every call site in the file. Check the other `/api/v1` routes for the
      same omission while in there, and note that admin domain routes were previously
      flagged for this too.

## P3: No tests at all

There is no test runner in this project. Three pure functions shipped today are cheap to
test and expensive to get wrong, and one of them silently produces invalid DNS advice if
it regresses.

- [ ] 3.1 Add a minimal runner (Vitest, no config beyond the defaults) and a `test`
      script. This is a new top-level dependency, so it needs Umut's explicit approval
      before installing.
- [ ] 3.2 Cover `isApexDomain` and `vercelPointingRecord`: apex with a simple TLD
      (`hmd.bio`), apex under a multi-label public suffix (`guden.com.tr`, `acme.co.uk`),
      subdomain (`go.acme.com`), deep subdomain under a public suffix
      (`a.b.acme.co.uk`). A CNAME must never be produced for an apex.
- [ ] 3.3 Cover `normaliseHost` (port, trailing dot, uppercase, `www.`, scheme, junk) and
      `hostnameSchema` (public suffix rejection, IP literals, the primary domain and its
      subdomains, blocklisted hostnames).

## P4: Housekeeping and decisions

- [x] 4.1 DONE. Deleted `src/components/admin/AdminNav.tsx`; confirmed no importer before
      removing it. `AdminShell.tsx` is the nav that renders.
- [ ] 4.2 Decide on three untracked files, on a PUBLIC repo: `DESIGN.md` (probably should
      be committed, contributors need it), `PRODUCT.md` and
      `tasks/fable-security-audit-prompt.md` (probably internal). Umut's call, not mine.
- [x] 4.3 DONE, committed.

## P5: Deferred from the build, still outstanding

- [ ] 5.1 Preview environment is missing `INTERNAL_SECRET`, `IP_HASH_SALT`,
      `IP_ENCRYPTION_KEY` (set only for one old branch) and both Turnstile keys
      (Production only). Previews build and serve but run degraded: no click logging, no
      internal resolution, signup returns 503. Dashboard job, the CLI cannot set
      "all preview branches" non-interactively.
- [ ] 5.2 A hostname's new owner cannot reuse a keyword the previous owner used, because
      the unique index still counts detached links. Fails closed with a 409, so it is a
      papercut rather than a leak. Fixing it properly needs a partial unique index on
      `domainDetachedAt: null` and therefore another migration.
- [x] 5.3 DONE. Admin user deletion now detaches every domain at Vercel before it touches
      anything locally, and aborts the whole deletion with a 502 naming the hostname if any
      detach fails, so a retry is safe rather than leaving half-done state. Carries the same
      `vercelDomainId` guard as the user-facing delete, and the projection was widened to
      select that field, without which the guard could never have fired. `removeDomain`
      treats a Vercel `not_found` as success, so retries are idempotent.
- [ ] 5.4 Two pending accounts have generated-looking usernames but verified emails:
      `rylan.rogers@sd68.bc.ca`, `lalasi@revenew.net`. They cleared email verification, so
      the purge script deliberately spared them. Umut's call whether to remove them.

---

## Verified working, for the record

Do not redo these:
- 298 links and 88,490 clicks migrated; compound `(domain, keyword)` index live; existing
  links still resolve (`hmd.bio/sptfy` returns 302).
- Turnstile enforced on signup and shorten; the site key is in the client bundle and the
  widget renders; unauthenticated signup returns 403.
- 106 bot accounts purged, 13 users remain, all verified.
- Dashboard and API are at parity for list, add, verify and delete.
- All `/api/v1/domains` routes pass `request` for format negotiation.
- The cron path, schedule and GET-plus-Bearer auth match what Vercel Cron sends.
- The hand-written `/docs` page is accurate, including both DNS records and the proxy
  warning.

## Working method for the next session

P1 is done and uncommitted. P0 is now the front of the queue, since it is the only open
item that can cause a customer active harm rather than merely mislead them; run it in its
own PR and keep the P1 spec work out of it or the diff becomes unreviewable. P2 is small
and can ride with P1. P3 needs approval before installing anything. P4 and P5 are decisions
more than work.

The `/docs` line under "Verified working" is now only half true: the page is accurate about
the mechanics but silent on the apex consequence. P0.5 closes that.

Deploy gate applies as always: `vercel pull` then `vercel build` for the target
environment, and watch the deployment to Ready.
