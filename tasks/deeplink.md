# Deeplink support (Universal Links / App Links) on custom domains

Goal: a custom domain on hmd.bio can act as a verified deeplink host, the role
`go.glasspadelapp.com` currently fills on EC2. Four capabilities, none of which
the shortener has today.

Guiding constraint: nothing here may change the behaviour of an existing link or
an existing custom domain. Every field is additive and defaults to today's
behaviour.

## 1. Data model (database)
- [ ] `Domain.mode: 'shortener' | 'deeplink'`, default `'shortener'`.
      A deeplink domain is a different kind of tenant, not a shortener domain
      with extra booleans set. Without this flag the new fields can be combined
      in states that make no sense.
- [ ] `Domain.appLinks.aasa: string | null` and `Domain.appLinks.assetlinks: string | null`.
      Stored as the raw string exactly as supplied, never a parsed object.
      Round-tripping through JSON.parse/stringify reorders keys, and Apple's CDN
      caches whatever it first served.
- [ ] `Domain.fallbackTarget: string | null` — where an unmatched path goes on a
      deeplink domain, instead of the `/not-found` rewrite.
- [ ] `Link.targets: { platform: 'ios' | 'android' | 'desktop', url: string }[]`,
      empty by default. `Link.url` stays required and is the fallback for any
      platform with no entry, so existing links are untouched.
- [ ] `Link.forwardPath: boolean` and `Link.forwardQuery: boolean`, both default
      `false`.

## 2. Serving the association files (backend, proxy)
- [ ] Serve `/.well-known/apple-app-site-association` and
      `/.well-known/assetlinks.json` on a deeplink custom domain, verbatim,
      `content-type: application/json`, HTTP 200, no redirect, no trailing-slash
      tolerance.
- [ ] This branch runs before the keyword logic and before the `.`/`/` skip in
      `src/proxy.ts:117`, which is what 404s these paths today.
- [ ] Never serve these on the primary domain or a `shortener`-mode domain.
- [ ] Validate on write (parseable JSON, size cap), serve bytes on read.

## 3. Platform targeting (backend)
- [ ] Resolve picks a target by parsing the UA into ios / android / desktop.
      Three buckets only. Falls back to `Link.url`.

## 4. Path and query forwarding (backend, proxy)
- [ ] When `forwardPath`/`forwardQuery` are set, compose the extra path segments
      and the query string onto the resolved target at the redirect in
      `src/proxy.ts:171`, which discards both today.

## 5. Catch-all (backend, proxy)
- [ ] On a deeplink domain, an unresolved keyword redirects to
      `Domain.fallbackTarget` instead of rendering `/not-found`.

## Verify
- [ ] `pnpm lint`, `npx tsc --noEmit`, `vercel build` green.
- [ ] Security review (Opus): tenant isolation, the verbatim-serving carve-out,
      open-redirect surface on `fallbackTarget` and the forwarding composition.
- [ ] Reviewer pass across the whole change.

## Explicitly not in this scope
- Dashboard UI for editing any of the above. API and model first.
- Migrating Glass. Per the agreed sequencing, `go.` stays on CloudFront until
  this is proven on a domain whose blast radius we control.
