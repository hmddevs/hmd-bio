# hmd-bio Feature Gaps vs YOURLS (HMDdotBio)

## Missing Features

### 1. ~~Link Editing~~ ✅ Done
Admin already has full link editing (PUT /api/v1/links/[keyword], edit dialog, keyword change with Click migration).
User dashboard now also has:
- `GET/PUT /api/v1/user/links/[keyword]` (ownership-checked)
- `/dashboard/links/[keyword]` detail page with edit dialog, stats, QR, share
- `GET /api/v1/user/stats/[keyword]` (ownership-checked per-link stats)
- `POST /api/v1/user/links/[keyword]/qr` (ownership-checked QR generation)
- Clickable rows in link list → detail page navigation

---

### 2. ~~Bookmarklets~~ ✅ Done
- `/admin/tools` and `/dashboard/tools` pages with draggable bookmarklet links
- 3 bookmarklet types: Popup Shorten, Custom Keyword, Quick Shorten
- `/bookmarklet` lightweight popup page (session-based auth, auto-shorten, copy)
- Tools nav item added to both admin and user sidebars

---

### 3. ~~Geo-Location Map Visualization~~ ✅ Done (pre-existing)
Already implemented via `CountryMap.tsx` (react-simple-maps choropleth) on both admin and user link detail pages.

---

### 4. ~~Referrer Grouping~~ ✅ Done
- Both admin and user stats APIs now return `referrerDomains` field
- Each entry: `{ domain, count, urls: [{ url, count }] }`
- Domain extracted from referrer URL with fallback to raw string

---

### 5. ~~Auto Title Fetching~~ ✅ Done (pre-existing)
Already implemented via `fetchPageTitle()` in shorten API (5s timeout, YouTube oEmbed shortcut, generic HTML `<title>` parsing).

---

### 6. ~~Public Stats Page~~ ✅ Done
- `/stats/[keyword]` public page with: link info, total clicks, 30-day bar chart, top countries, top referrers, continue-to-destination button
- `hmd.bio/abc+` suffix rewrites to `/stats/abc` (proxy updated)
- Password-protected links return 404 on public stats

---

### 7. ~~API Output Formats~~ ✅ Done
- `?format=json|xml|jsonp|simple` supported on `/shorten`, `/expand`, `/stats`, `/stats/[keyword]`
- JSONP: `?format=jsonp&callback=myFunc` wraps in callback (validated identifier)
- Simple: returns just the short URL (shorten) or long URL (expand) as plain text
- XML: full response serialized with `<?xml?>` header
- Format helper in `src/lib/format-response.ts`

---

### 8. ~~Version Endpoint~~ ✅ Done
- `GET /api/v1/version` → `{ version, node, uptime }`
- No auth required, `force-dynamic`

---

### 9. ~~Fuzzy Keyword Suggestions~~ ✅ Done
- When a custom keyword is taken, 409 response now includes `suggestions` array
- Suggestions: numeric suffixes (keyword1, keyword2, …), filtered for availability
- `apiError()` extended to support optional `suggestions` parameter

---

### 10. ~~Sequential Keyword Option~~ ✅ Done
- Option `keywordMode` in Options collection: `"random"` (default) or `"sequential"`
- Option `nextSequentialId` auto-incremented atomically via `findOneAndUpdate`
- Sequential IDs encoded as base-62 (0-9, a-z, A-Z) for compact keywords
- `numberToBase62()` utility in `src/lib/utils.ts`

---

## Features hmd-bio Already Has Over YOURLS

| Feature | Details |
|---|---|
| Password-protected links | Native bcrypt-based, with dedicated UI page |
| Link expiration (TTL) | MongoDB auto-deletes expired links |
| Bulk import/export | CSV import and export via API |
| Browser & OS detection | UA parsing stored per click |
| Dark mode | Theme toggle in admin |
| API key management | Named keys, create/revoke from settings |
| OpenGraph metadata | Custom OG title, description, image per link |
| 301/302 per-link control | Choose redirect type per link |
| Modern responsive admin | Material-UI, mobile-optimized |
| Cloudflare Turnstile | Modern bot protection (vs reCAPTCHA) |
