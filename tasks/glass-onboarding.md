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

- [ ] Per-key scopes, at minimum read-only versus read-write.
- [ ] Optional per-domain restriction.
- [ ] Optional expiry.
- [ ] Enforced in `authenticateRequest`, not at each call site.
- [ ] Backwards compatible: existing keys keep working as full-access.

## P2. Audit logging

An administrator can decrypt a visitor's IP and nothing records it. That cannot
sit behind a signed DPA.

- [ ] Audit log of administrative access to decrypted IPs, and of destructive
      admin actions. Who, what, when. Never the decrypted value itself.

## P3. Click retention

Retained indefinitely, no configurable policy, no deletion path.

- [ ] A defined default retention period, enforced automatically.
- [ ] Deletion available without contacting support.

## P4. Confirm the redirect rate-limit key

The redirect limit keys on the visitor IP forwarded from the edge. If that
header is ever empty the key collapses to one shared bucket of 120/min across
all visitors, which would throttle a booking peak. Not yet proven under
production conditions, and it affects every customer, not only Glass.

- [ ] Establish which happens, and fix it if the key can collapse.

## Not gating, but promised in writing

- Per-link status codes are 301/302 only. The unmatched-path fallback is a
  hardcoded 302 and is not configurable per domain. Both were disclosed in the
  reply as partial support.
- Real-device verification of universal links needs their actual app. Everything
  up to and including the bytes Apple and Google fetch is proven.
