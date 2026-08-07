# Custom domains — remaining work

The feature is live and working. Links resolve, domains verify, the dashboard shows both
DNS records, Turnstile is enforced. What follows is what is genuinely NOT done.

The completed build plan is in git history (PRs #10, #11, #12). This file now tracks only
what is left.

Ordered by whether it misleads a user, then by risk.

---

## P1 — The API reference does not know custom domains exist

**The miss:** `src/lib/openapi.ts` is the spec served at `/api/docs` and `/api/admin/docs`.
It contains zero mention of `/api/v1/domains`. The domains documentation written during
the build went into `src/lib/openapi-public.ts`, which is imported by nothing and reaches
no user. Neither spec mentions `pointingRecord`.

Consequence: a developer reading the formal API reference cannot discover the domains
endpoints at all, and cannot see the `domain` field on the endpoints they can find.

- [ ] 1.1 Decide the fate of the two spec files, then act on it. Options:
      (a) fold the domains content from `openapi-public.ts` into `openapi.ts` and delete
          `openapi-public.ts`;
      (b) wire `openapi-public.ts` to `/api/docs` and keep `openapi.ts` for
          `/api/admin/docs` only, if the split was deliberate.
      Check git history and `src/app/api/admin/docs/route.ts` before choosing. (a) is
      likely right unless the split was intentional. RESOLVE THIS FIRST, everything below
      depends on which file is canonical.
- [ ] 1.2 In the canonical spec, document all five domains endpoints: GET and POST
      `/api/v1/domains`, GET and DELETE `/api/v1/domains/{hostname}`, POST
      `/api/v1/domains/{hostname}/verify`. Include every status the routes actually
      return, verified against the source rather than assumed:
      - GET /domains: 200, 401, 429
      - POST /domains: 201, 400, 401, 403, 409, 429
      - GET /domains/{hostname}: 200, 400, 401, 404, 429
      - DELETE /domains/{hostname}: 200, 400, 401, 404, 409, 502, 503
      - POST /domains/{hostname}/verify: 200, 202, 400, 401, 403, 404, 409, 429, 503
- [ ] 1.3 Add `pointingRecord` to the `Domain` schema and to every response that returns
      it. Document that it is null once a domain is active.
- [ ] 1.4 Confirm the spec covers the rest of today's changes: `domain` on POST
      `/api/v1/shorten` and in link responses, `?domain=` on `/api/v1/links` and
      `/api/v1/links/{keyword}`, `shortUrl` in link responses, and the `domain` column now
      leading the `/api/v1/links/export` CSV (a breaking change for positional parsers,
      call it out explicitly).
- [ ] 1.5 Document the asymmetry that will trip people up: omitting `?domain=` on the
      links LIST returns links across all the caller's domains, but omitting it on a
      single link defaults to the primary domain only.

## P2 — Inconsistent API responses

- [ ] 2.1 `POST /api/v1/domains/{hostname}/verify` returns `pointingRecord` on 200 but not
      on 202, which is the one response where the user most needs it. Add it.
- [ ] 2.2 `/api/v1/shorten` never passes `request` to `apiSuccess`/`apiError`, so
      `?format=json|xml|jsonp|text` is silently ignored on the single most-used endpoint
      in the API. Fix every call site in the file. Check the other `/api/v1` routes for the
      same omission while in there, and note that admin domain routes were previously
      flagged for this too.

## P3 — No tests at all

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

## P4 — Housekeeping and decisions

- [ ] 4.1 Delete `src/components/admin/AdminNav.tsx`. It is untracked and imported by
      nothing; `AdminShell.tsx` is the nav that renders. It has already caused one wasted
      change this session.
- [ ] 4.2 Decide on three untracked files, on a PUBLIC repo: `DESIGN.md` (probably should
      be committed, contributors need it), `PRODUCT.md` and
      `tasks/fable-security-audit-prompt.md` (probably internal). Umut's call, not mine.
- [ ] 4.3 Commit this file.

## P5 — Deferred from the build, still outstanding

- [ ] 5.1 Preview environment is missing `INTERNAL_SECRET`, `IP_HASH_SALT`,
      `IP_ENCRYPTION_KEY` (set only for one old branch) and both Turnstile keys
      (Production only). Previews build and serve but run degraded: no click logging, no
      internal resolution, signup returns 503. Dashboard job, the CLI cannot set
      "all preview branches" non-interactively.
- [ ] 5.2 A hostname's new owner cannot reuse a keyword the previous owner used, because
      the unique index still counts detached links. Fails closed with a 409, so it is a
      papercut rather than a leak. Fixing it properly needs a partial unique index on
      `domainDetachedAt: null` and therefore another migration.
- [ ] 5.3 Admin user deletion releases a user's `Domain` records but never calls Vercel's
      `removeDomain`, so their domains stay attached to the Vercel project.
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

P1 first and alone, since it is the only item a user can currently be misled by, and 1.1
gates the rest of it. P2 is small and can ride in the same PR. P3 needs approval before
installing anything. P4 and P5 are decisions more than work.

Deploy gate applies as always: `vercel pull` then `vercel build` for the target
environment, and watch the deployment to Ready.
