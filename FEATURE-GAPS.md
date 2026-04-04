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

### 2. Bookmarklets (Medium Priority)
YOURLS provides 4 bookmarklet types on `/admin/tools.php`:
- **Standard** — opens a popup to shorten the current page
- **Instant** — shortens immediately, shows result in a small overlay
- **Custom Keyword** — prompts for a custom keyword before shortening
- **Simple** — redirects to the YOURLS admin with the URL pre-filled

These let users quickly shorten any page from their browser toolbar.

**What's needed:**
- A `/admin/tools` page with copyable bookmarklet `javascript:` links
- Each bookmarklet calls `POST /api/v1/shorten` with the current page URL
- A lightweight popup/overlay HTML page that the bookmarklet opens

---

### 3. Geo-Location Map Visualization (Medium Priority)
YOURLS renders a Google Charts geo map per link showing click distribution by country. hmd-bio stores `countryCode` in Click documents but doesn't visualize it.

**What's needed:**
- Aggregate clicks by `countryCode` per link
- Render a choropleth/geo map (e.g., `react-simple-maps` or Google GeoChart)
- Add to the link detail/stats page

---

### 4. Referrer Grouping (Low Priority)
YOURLS groups referrers by domain (e.g., "twitter.com — 45 clicks") with drill-down to full URLs. hmd-bio stores the full `referrer` string but only shows it as raw text in click logs.

**What's needed:**
- Aggregate clicks by referrer domain
- Show top referrer domains with counts on link stats page
- Optionally allow drill-down to individual referrer URLs

---

### 5. Auto Title Fetching (Medium Priority)
YOURLS fetches the `<title>` tag from the target URL when creating a link. hmd-bio requires the title to be manually provided (or leaves it empty).

**What's needed:**
- On link creation (API and UI), if no title is provided, fetch the target URL and extract `<title>`
- Use a timeout (e.g., 3s) so slow sites don't block link creation
- Fallback gracefully if fetch fails

---

### 6. Public Stats Page (Low Priority)
YOURLS allows viewing per-link stats by appending `+` to the short URL (e.g., `hmd.bio/abc+`). hmd-bio has a preview page (`/preview/[keyword]`) but no public stats view.

**What's needed:**
- A `/stats/[keyword]` public page showing click count, creation date, and basic chart
- Proxy/middleware support for the `+` suffix pattern
- Optionally gate behind a config flag (some users prefer private stats)

---

### 7. API Output Formats (Low Priority)
YOURLS supports XML, JSON, JSONP, and plain text output via a `format` query parameter. hmd-bio is JSON-only.

**What's needed:**
- Accept `?format=json|xml|jsonp|simple` on public API endpoints (`/shorten`, `/expand`, `/stats`)
- JSONP: wrap response in callback function
- Simple: return just the short URL as plain text
- XML: serialize response as XML

---

### 8. Version Endpoint (Low Priority)
YOURLS has `action=version` returning the installed version and DB version. Useful for monitoring and integrations.

**What's needed:**
- `GET /api/v1/version` returning `{ version, node, uptime }` or similar

---

### 9. Fuzzy Keyword Suggestions (Low Priority)
YOURLS plugin suggests similar available keywords when the requested one is taken (e.g., "abc" taken → suggests "abc1", "abc2").

**What's needed:**
- When keyword validation fails (taken), generate and return 3–5 alternatives
- Append digits or a random suffix to the base keyword

---

### 10. Sequential Keyword Option (Low Priority)
YOURLS supports sequential numeric IDs (base-36 or base-62) as an alternative to random keywords. hmd-bio only generates random keywords.

**What's needed:**
- Store a `nextId` counter in the Options collection
- On link creation without a custom keyword, optionally use the next sequential ID
- Config flag to choose between random and sequential modes

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
