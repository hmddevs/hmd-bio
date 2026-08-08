# Onboarding readiness for Glass Padel

Separate from `tasks/todo.md`, which tracks custom-domain work in general. This
file tracks only what stands between us and letting a third party put production
traffic on the platform.

"Ready" here is the set of gaps found on 2026-08-07 when their enquiry was
answered against the code rather than from memory. Three are prerequisites we
would impose on ourselves before a customer depends on us. One is visible to
their users and blocks migration outright.

Commercial and legal readiness (pricing, DPA, terms of service, uptime
commitment, support terms, per-subprocessor storage regions) is not in this
plan. It is the owner's to supply and cannot be derived from the codebase.

Their setup: one domain, `go.glasspadelapp.com`, serving an AASA for
`Q95C7M5N6L.com.reputeus.glasspadel`, an assetlinks.json for
`com.reputeus.glasspadel` with two signing fingerprints, and short links under
`/l/<code>` with unmatched paths falling back to `https://glasspadelapp.com/`.
Low thousands of redirects a day, peaking around bookings and match invitations.

## P0. Per-domain path prefix

The blocker. Their codes live at `/l/<code>`; we resolve only at the root, and
the keyword regex forbids slashes, so `/l/abc123` 404s. Verified against a live
custom domain, not inferred. Migrating without this breaks every link already in
circulation, silently, in invitations already sent.

It also interacts with requirement 1 of their enquiry: their AASA deliberately
excludes `/l/*` from app interception so short links resolve server-side. Move
the codes to the root and that exclusion no longer covers them, so the app would
start swallowing short links.

- [x] `Domain.pathPrefix`, nullable, default null so nothing changes for an
      existing domain. Stored without slashes, one canonical form.
- [x] Resolver support, additive: a prefixed path resolves, and root paths keep
      resolving exactly as before, including on a domain that sets a prefix.
- [x] Reject prefixes that would shadow platform paths. Derived from
      `BYPASS_PREFIXES` rather than restated, so the two cannot drift.
- [x] Path and query forwarding composes on top of a prefixed path.
- [x] Association files still served regardless of prefix.
- [x] API, dashboard, OpenAPI, 25 tests.
- [x] Prefixed links must degrade like root links do. When the internal resolve
      API is unreachable the proxy falls through to Next and the fallback page
      reads Mongo directly. That route was a single dynamic segment, so a
      prefixed link 404ed instead of degrading. This is not theoretical: that
      fallback is the only reason nobody noticed the internal fetch was broken
      from #28 until #30. Glass links are booking invitations, so they must not
      be the first thing to fail in an outage. Done by making the route a
      catch-all, `src/app/[...keyword]/page.tsx`, gated on the pure
      `fallbackKeywordFromSegments`, so only a genuine prefixed link on a domain
      that configures a prefix resolves and everything else keeps its 404.
- [x] Proved in production on `go.guden.com.tr`, 2026-08-08, driven over the
      public API with a temporary key, in the full Glass shape: `pathPrefix`
      set to `l`, deeplink mode, and an AASA carrying an `exclude: true` rule
      for `/l/*` exactly as theirs does. Results: `/l/<code>` resolves (404
      before the deploy); root links still resolve, so the additive invariant
      holds against live data; `/list/<code>`, `/L/<code>` and `/l/a/b/c` all
      404, so matching is whole-segment, case-sensitive and depth-bounded; the
      association files are served byte-identical and are not shadowed by the
      prefix, with the `/l/*` exclude intact; a prefixed link targets per
      platform and forwards path and query
      (`/l/glassx/deep/path?ref=xyz` to `.../docs/deep/path?platform=ios&ref=xyz`);
      unmatched paths reach the fallback; the primary domain is unaffected; and
      `pathPrefix: "icons"` is refused with a 400. Test link and config removed,
      key revoked, domain restored and re-verified.

## P1. API key scoping

A key grants full account access, never expires, and cannot be restricted. Too
weak to hand to a third party.

- [x] Per-key scopes, read-only versus read-write. Two values, not a resource
      set: the required scope is derived from the request method inside
      `authenticateRequest`, so a route added later is covered without anyone
      remembering to annotate it. A resource set would have needed exactly the
      per-route declaration that produced the reserved-keyword drift.
- [x] Optional per-domain restriction. Enforced at three points, each of which
      a route already had to pass through: `requireOwnership` for a single
      link or domain, `ownedDomainFilter` for a Domain addressed by hostname,
      and `checkDomainWritable` when creating. List endpoints spread
      `domainScopeFilter` into their query.
- [x] Optional expiry. An expired key is a 401, not a 403: an expired
      credential is no credential. An unreadable expiry is treated as expired.
- [x] Enforced in `authenticateRequest`, not at each call site. The scope
      decision itself is a pure module, `src/lib/api-key-scope.ts`, with 47
      tests over it.
- [x] Backwards compatible: existing keys keep working as full-access. Absent
      means unrestricted throughout, every new schema path is
      `default: undefined` so Mongoose cannot stamp a value onto a legacy key,
      and two tests assert that against the real schema rather than a mock.
- [x] Escalation closed. A key cannot mint, list or revoke keys at all
      (session-only, refused on `via` rather than on scope), and never carries
      its owner's admin role: `authenticateRequest` downgrades a key caller to
      `role: "user"`, which disarms all eight inline admin checks at once.

One deliberate behaviour change, called out because it is not additive: an
administrator's existing API key can no longer reach `/api/v1/admin/**`, nor
use the admin bypass in `requireOwnership`, nor list other users' links via
`/api/v1/links`. That is the point of the requirement, but it is the one way a
live key behaves differently after this change.

## P2. Audit logging

An administrator can decrypt a visitor's IP and nothing records it. That cannot
sit behind a signed DPA.

- [x] Audit log of administrative access to decrypted IPs, and of destructive
      admin actions. Who, what, when. Never the decrypted value itself. Shipped
      in #38, which replaced #35 (main had moved twice underneath it).

Three things review caught that would have made the log a claim rather than a
control, all fixed before merge:

- [x] The 400-day TTL it advertises did not exist. `db.ts` sets
      `autoIndex: false` because index creation belongs to `scripts/`, so a
      declared `Schema.index()` is inert in production. Retention is the part a
      DPA rests on. `scripts/migrate-audit-log-indexes.ts` now creates the
      declared indexes and proves the TTL by exact key pattern and period.
      **Run against production on 2026-08-08**, on an empty collection, so the
      TTL could not delete anything on creation: four indexes created,
      retention verified at 34,560,000s. Generalises: every new schema index
      needs a matching migration in the same PR.
- [x] The clicks route failed open. The audit write cannot fail an admin
      *write*, correctly, since by then the action has committed. That does not
      transfer to a *read*: nothing had been disclosed yet, so it now returns
      503 and no rows unless the entry was written.
- [x] Admin edits to a link were unaudited while deletions were. Both decide
      through one predicate now, rather than restating the ownership test,
      which is how they came to differ.

## P3. Click retention

Retained indefinitely, no configurable policy, no deletion path.

Design changed before any code was written, on the production numbers: a
12-month TTL would delete 86,427 of 88,517 clicks, 98% of all analytics, and
24 months still removes 58%. Glass asked where click data is stored and for how
long, which is a question about retention of *personal* data. Destroying 98% of
the click history to answer it would be answering a privacy question by
deleting the product. So P3 ages out the personal fields (encrypted IP, IV,
user agent) and keeps the anonymous row (timestamp, country, browser, OS,
keyword). That is what data minimisation actually asks for. Outright deletion
stays available as a per-customer option.

- [x] Anonymise the personal fields on a schedule, keeping the analytics row.
      `src/lib/click-retention.ts` holds the rules,
      `scripts/anonymise-old-clicks.ts` is the operator interface, and
      `/api/internal/clicks/retention` is the Vercel Cron job (daily at 04:30,
      authenticated with `CRON_SECRET` exactly as the domain re-check is).
      Bounded at 40 batches of 500 per invocation, so a first run on a backlog
      cannot run away; the filter makes a truncated run resume rather than
      repeat.
- [x] Deletion available without contacting support.
      `DELETE /api/v1/links/{keyword}/clicks`, `mode: "anonymise" | "delete"`,
      with a confirmation echoing `domain/keyword`.
- [ ] **SETTING `CLICK_RETENTION_DAYS` IS THE ACT THAT SWITCHES RETENTION ON,
      and it is still unset.** The scheduled job is deployed and inert: with no
      value, an empty value, or anything that is not a positive whole number,
      it touches nothing, reports that retention is unconfigured, and returns
      success. It invents no default, so nothing ages out until Umut picks the
      number. Before the first live run, dry-run
      `npx tsx scripts/anonymise-old-clicks.ts --age-days=<the same number>`,
      which writes nothing and prints exactly how many rows the job will
      rewrite. The count should be known in advance, not discovered afterwards.
- [x] Erasure is audited whoever performs it. The original rule left
      self-service erasure unrecorded, which meant a stolen write-scoped key
      could destroy an account's click logs link by link and leave nothing
      behind. The log's remit is administrative access *and* destructive
      actions, and an erasure is irreversible whoever asks for it; an entry
      recording that a customer erased their own data, when, and over how many
      rows, is also what answers a later dispute. Self-service records
      `link.click.*`, an administrator on somebody else's link records
      `admin.click.*`, decided by the same `isAdministrativeAccess` predicate.
- [ ] Do NOT create the TTL index as part of shipping. A TTL acts on existing
      documents the moment it exists, so merging one would silently delete
      86,000 rows on deploy. Build the mechanism; the period stays Umut's to
      set. The audit log's own 400 days was picked assuming P3 landed at twelve
      months, so it is now a standalone choice and revisitable.

## P4. Confirm the redirect rate-limit key

The redirect limit keys on the visitor IP forwarded from the edge. If that
header is ever empty the key collapses to one shared bucket of 120/min across
all visitors, which would throttle a booking peak. Not yet proven under
production conditions, and it affects every customer, not only Glass.

- [x] Settled, and it does not collapse. Measured on the ciphertext lengths of
      18 production clicks, which reveal plaintext length without the key: all
      12 to 13 characters, so all real IPv4 addresses and none of the 46-hex
      shape a literal "unknown" would produce. The redirect limiter is genuinely
      per-visitor.

## Open, not gating onboarding

- [ ] **Error capture is off, application-wide.** There was no instrumentation
      file, so `sentry.server.config.ts` was imported by nothing, `Sentry.init`
      never ran in the Node or edge runtime, and every server-side
      `captureError` in the codebase was silently discarded.
      `withSentryConfig({ silent: true })` suppressed the SDK's own warning
      about exactly that. `src/instrumentation.ts` (#38) fixes the code half,
      but there is no Sentry variable of any kind in the Vercel production
      environment, so capture stays inert until a DSN is set. Needs
      `SENTRY_DSN`, plus `NEXT_PUBLIC_SENTRY_DSN` for browser capture, since a
      bare `SENTRY_DSN` is not exposed to client bundles. Umut's call; deferred
      deliberately on 2026-08-08. Until then, verify nothing by "it is reported
      to Sentry".
- [ ] The audit log has no read path. Nothing in the app or API queries it, so
      answering a DPA question today means direct database access. The
      `subjectType`/`subjectIds`/`createdAt` index exists for that surface.
- [ ] `Link.url` still accepts `javascript:` and `data:` via Zod's
      `z.string().url()`, and deeplinks made it the universal fallback.
      Tightening it breaks any customer already storing a custom-scheme URL, so
      it needs a production data check first.
- [ ] `INTERNAL_SECRET` rotation. If any customer-owned domain has ever been
      `active`, treat the secret as disclosed.
- [ ] Nothing caps how many API keys an account may hold, so N keys can
      collectively reach the account rate-limit ceiling. Per-key isolation
      bounds one key, not all keys together.

## Not gating, but promised in writing

- Per-link status codes are 301/302 only. The unmatched-path fallback is a
  hardcoded 302 and is not configurable per domain. Both were disclosed in the
  reply as partial support.
- Real-device verification of universal links needs their actual app. Everything
  up to and including the bytes Apple and Google fetch is proven.
