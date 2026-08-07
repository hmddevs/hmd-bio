# Deeplink support (Universal Links / App Links) on custom domains

Goal: a custom domain on hmd.bio can act as a verified deeplink host, the role
`go.glasspadelapp.com` currently fills on EC2. Four capabilities, none of which
the shortener had.

Guiding constraint, held throughout: nothing here changes the behaviour of an
existing link or an existing custom domain. Every field is additive and defaults
to previous behaviour.

## Shipped: serving engine (PR #28, merged as 921531f)

- [x] `Domain.mode: 'shortener' | 'deeplink'`. A deeplink domain is a different
      kind of tenant, not a shortener with extra booleans set. Without the mode
      flag the new fields combine into states that mean nothing.
- [x] `Domain.appLinks.aasa` / `.assetlinks`, stored as the raw string exactly
      as supplied. Never parsed and re-stringified: that reorders keys, and
      Apple's CDN caches whichever bytes it saw first.
- [x] `Domain.fallbackTarget`, `Link.targets[]`, `Link.forwardPath`,
      `Link.forwardQuery`.
- [x] Association files served verbatim on a deeplink domain, before the keyword
      logic, `application/json`, 200, no redirect, `nosniff`, 60s cache matched
      to the config TTL.
- [x] Platform targeting from the user agent, three buckets, falling back to
      `Link.url`.
- [x] Path and query forwarding, composed onto the resolved target.
- [x] Per-domain catch-all for unmatched paths.

Also fixed in that PR: a pre-existing secret disclosure. The proxy built its
internal fetch URLs from the request origin, which on a custom domain is a
hostname the tenant's own DNS resolves, so a tenant could repoint their A record
and collect `INTERNAL_SECRET`. Internal calls now use a platform-trusted origin.

## Shipped: configuration (this branch)

- [x] Validation schemas: association-file structure and byte cap, http/https
      only for every redirect target, target list bounds.
- [x] `PATCH /api/v1/domains/{hostname}`, partial update, owner-scoped, calling
      `invalidateDomainConfig` because these edits leave `status` untouched and
      would otherwise serve stale config for 60s.
- [x] `targets` / `forwardPath` / `forwardQuery` threaded through link create
      and edit.
- [x] Dashboard UI. Reads current state from `GET`, which was widened to return
      the deeplink fields. The dialog cannot save until that load succeeds:
      opening it blank and pressing save would otherwise have sent `mode`
      against assumed state and reverted a live deeplink domain to `shortener`.
- [x] OpenAPI spec and developer docs.
- [x] Tests for the pure logic. Vitest, 60 tests, `pnpm test`. First test suite
      in this repo, so the harness is new too.

Also fixed here, both found by review rather than planned:

- [x] `absoluteHttpUrl` validated the parsed URL but stored the raw string.
      WHATWG `new URL()` strips every tab, CR and LF anywhere in the input, so
      `https://good.com<TAB>.evil.com` validated as one host and was stored as
      another, and the stored form is what the public `/stats/{keyword}+`
      preview shows a visitor. It now stores the normalised URL.
- [x] `internalOrigin` still derived the `INTERNAL_SECRET`-bearing origin from
      `request.url` on the platform branch. The gate is `isPlatformHost`, which
      is decided from a request header and returns true for an empty host and
      for any `*.vercel.app` name, a namespace Vercel allocates first-come to
      any customer. The origin now comes from a fixed allowlist and the function
      takes no request at all. This completes the PR #28 fix, which closed only
      the custom-domain branch.

## Still open before anyone is told this is ready

- [ ] `INTERNAL_SECRET` rotation decision. If any customer-owned domain has ever
      been `active`, the secret should be treated as disclosed. Owner's call.
- [x] Prove it on a domain whose blast radius we control. Done on
      `go.guden.com.tr`, 2026-08-07, driven entirely over the public API with a
      temporary key, since that is the path a customer takes. The first run
      failed: both association files 404 and the fallback target was ignored,
      while the config read back correctly from the database and the API.
      Cause in the next item. After the fix, re-run on the same domain:
      association files 200 as `application/json` with `nosniff` and
      byte-identical to what was uploaded, including deliberately irregular key
      order and whitespace; iOS, Android and desktop user agents each resolved
      to their own target; `/prooflink/deep/path?ref=xyz` forwarded to
      `…/docs/deep/path?platform=ios&ref=xyz`, so path and query compose without
      dropping the target's own parameters; an unmatched path redirected to the
      fallback; and the two pre-existing shortener links on the domain were
      untouched, which is the additive invariant holding in production rather
      than in principle. Switching the domain back to `shortener` took effect
      immediately, so invalidation works in both directions. Test link and
      config removed, key revoked.
- [x] Deeplink serving had never worked in production, on any domain. Vercel
      Authentication is set to `all_except_custom_domains`, so every
      `*.vercel.app` URL answers a bare request with a 302 to the SSO login, and
      `internalOrigin` preferred `VERCEL_URL`. `fetch` follows that redirect and
      returns the login page with `ok === true`, so nothing throws: the call
      succeeds, hands back HTML, and fails only at the JSON parse, which
      `fetchDomainConfig` turns into `null`. The proxy cannot distinguish that
      from "this domain is an ordinary shortener", so the feature degraded
      silently into the behaviour it was replacing. Fixed in #30 by preferring
      the primary domain, which is what the protection rule exempts, and by
      refusing to follow redirects so a wrong origin fails loudly. Worth
      remembering: every layer looked correct in isolation, and only requesting
      the file from the real host showed it was broken.
- [ ] Real installs, on real devices. Not provable here: Apple and Google verify
      an association file against a real app's team ID or package signature, so
      this needs the actual app. Everything up to and including the bytes those
      services fetch is now proven.
- [ ] Preview deployments cannot read domain config: their own origin is
      SSO-protected and the primary domain would run production code, so a
      preview behaves as a shortener. Needs the deployment protection-bypass
      secret on the internal fetch. Production is unaffected.
- [ ] `Link.url` is still validated by `z.string().url()`, which in Zod 4
      accepts `javascript:` and `data:`. It was harmless while it was only a
      redirect target, but deeplinks made it the desktop bucket and the
      universal fallback for every platform, so the one field with no scheme
      check is now the one everything falls back to. Tightening it to
      `absoluteHttpUrl` is a behaviour change for any customer already storing a
      custom-scheme URL, so it needs a production data check first. Deliberately
      left out of the config-layer PR. Production checked on 2026-08-07: of 301
      links, 277 were `https:` and 22 `http:`, none carried a dangerous scheme,
      and the only 2 exceptions were schemeless bare hostnames that `new URL()`
      rejects, so they were already broken and have been deleted. The change is
      therefore safe; it is left open only because it is the owner's call.

## Sequencing, unchanged

Glass is not the first customer. A wrong association file breaks every link
already shared, silently, on phones we cannot see, and Apple's CDN makes it slow
to undo. `go.glasspadelapp.com` stays on CloudFront until this is boring
elsewhere.
