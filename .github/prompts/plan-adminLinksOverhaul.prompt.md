---
description: "Plan comprehensive overhaul of HMD.bio admin: inline editing, YOURLS-style link list, richer stats, expanded click data, bookmarklets, auto title fetch, public stats, API formats, and more"
agent: "Plan"
---

# Admin Links & Statistics Overhaul

You are planning a comprehensive overhaul for HMD.bio to close feature gaps with YOURLS while leveraging HMD.bio's modern stack advantages. Study the current implementation thoroughly before proposing changes.

## Context Files

- Link list page: `src/app/admin/(dashboard)/links/page.tsx`
- Link detail/stats page: `src/app/admin/(dashboard)/links/[keyword]/page.tsx`
- Click model: [Click.ts](../../src/models/Click.ts)
- Link model: [Link.ts](../../src/models/Link.ts)
- Option model: [Option.ts](../../src/models/Option.ts)
- Click logging (resolve): [resolve/route.ts](../../src/app/api/internal/resolve/route.ts)
- Proxy/middleware: [proxy.ts](../../src/proxy.ts)
- Stats API: [stats/route.ts](../../src/app/api/v1/stats/route.ts)
- Per-link stats API: [stats/\[keyword\]/route.ts](../../src/app/api/v1/stats/[keyword]/route.ts)
- Links API: [links/route.ts](../../src/app/api/v1/links/route.ts)
- Link CRUD API: [links/\[keyword\]/route.ts](../../src/app/api/v1/links/[keyword]/route.ts)
- Shorten API: [shorten/route.ts](../../src/app/api/v1/shorten/route.ts)
- Validations: [validations.ts](../../src/lib/validations.ts)

## What HMD.bio Already Has Over YOURLS

Do NOT re-implement or regress these — they are advantages to preserve:

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

---

## 1 — Inline Quick Edit on Links List (High Priority)

The links page (`/admin/links`) currently only supports viewing and deleting. To edit a link, you must navigate to the detail page. This is slow and disruptive. YOURLS allows editing URL, keyword, and title in-place from the main table.

**Requirements:**
- Add inline editing directly in the link list table rows (destination URL, title, keyword, status code, expiration, OG fields)
- Toggle edit mode per-row without full page navigation (pencil icon or double-click)
- Save/cancel controls inline; optimistic UI update
- Keep the existing click-to-navigate behavior for the row itself (edit icon should be a separate action that stops propagation)
- **Keyword rename**: if the keyword changes, update ALL Click documents referencing the old keyword atomically (use a MongoDB transaction or bulk update)
- Bulk actions: select multiple links → bulk delete, bulk export
- Copy short URL button per-row (currently missing)

## 2 — Better Link List (YOURLS-style) (Medium Priority)

The current table is basic. YOURLS shows richer per-row information and better affordances.

**Requirements:**
- Show more data per-row: IP of creator, creation timestamp (relative + absolute on hover), last click timestamp
- Action buttons per-row: copy short URL, QR code, share, edit, stats, delete (currently only delete exists)
- Visual density: compact mode toggle for power users with many links
- Keyboard shortcuts: `/` to focus search, `j`/`k` to navigate rows, `e` to edit, `d` to delete
- Responsive: on mobile, collapse columns gracefully or switch to card layout
- Performance: virtual scrolling or keep pagination but increase default page size option to 250

## 3 — Better Statistics Display (Medium Priority)

The link detail page has charts but the data presentation can be richer and faster.

**Requirements:**
- Summary cards at the top: total clicks, unique visitors (if deducible from hashed IPs), clicks today, best day, average clicks/day
- Timeline chart: add comparison overlay (this week vs last week)
- Referrer breakdown: show favicons, **group by domain** (e.g. "twitter.com — 45 clicks"), highlight top referrer prominently, allow **drill-down** to individual referrer URLs within a domain
- Country breakdown: improve the map with hover tooltips showing click count + percentage (choropleth via `react-simple-maps`)
- Device breakdown: add device type (mobile/tablet/desktop) as a separate section alongside browser/OS
- Load stats data incrementally: show skeleton loaders per section, load heavy aggregations (map, timeline) after initial paint
- Add a "raw clicks" log table (paginated) so the admin can see individual click events with all captured fields
- Export stats as CSV or PDF

## 4 — Expanded Click Data Collection (High Priority)

The Click model currently captures: `keyword`, `referrer`, `userAgent`, `ip` (hashed), `countryCode`, `browser`, `os`. We can collect significantly more.

**New fields to add to the Click model:**
- `deviceType` — mobile, tablet, desktop (derivable from UA)
- `language` — from `Accept-Language` header
- `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent` — parse from **both** the referrer URL and the destination URL query params; store with a `utmOrigin` field (`referrer` | `destination`) to distinguish source
- `city`, `region` — from geo headers (Vercel provides `x-vercel-ip-city`, `x-vercel-ip-country-region`)
- `isBot` — boolean flag for known bot user agents
- `connectionType` — if available from headers
- Do NOT add screen resolution or any client-side JS tracking — keep redirects pure server-side with zero added latency

**Migration strategy:**
- Add new fields as optional with defaults (`""` or `null`) so existing documents remain valid
- Old clicks that lack new fields should display "Not enough data" or "N/A" gracefully in the UI — never crash or show undefined
- Update the resolve endpoint (`/api/internal/resolve`) to capture new data points
- Create a display helper that checks field presence: if a field is `null`/empty across all clicks for a link, hide that section entirely rather than showing empty charts

## 5 — Auto Title Fetching (Medium Priority)

YOURLS auto-fetches the `<title>` tag from the target URL on link creation. HMD.bio requires the title to be manually provided or leaves it empty.

**Requirements:**
- On link creation (both API and admin UI), if no title is provided, fetch the target URL and extract `<title>`
- Use a timeout (3s max) so slow sites don't block link creation — fire-and-forget pattern: create the link immediately, backfill the title async
- Fallback gracefully if fetch fails (leave title empty, don't error)
- Also offer a "re-fetch title" action button on existing links with empty titles

## 6 — Bookmarklets (Medium Priority)

YOURLS provides 4 bookmarklet types on `/admin/tools.php` for quickly shortening any page from the browser toolbar. HMD.bio has no equivalent.

**Requirements:**
- Add a `/admin/tools` page (new tab in admin nav) with copyable bookmarklet `javascript:` links
- **Standard** — opens a popup to shorten the current page URL
- **Instant** — shortens immediately, shows result in a small overlay
- **Custom Keyword** — prompts for a custom keyword before shortening
- Each bookmarklet calls `POST /api/v1/shorten` with the current page URL and the user's API key
- A lightweight standalone HTML popup page that the bookmarklet opens (minimal JS, no framework)

## 7 — Public Stats Page (Low Priority)

YOURLS allows viewing per-link stats by appending `+` to the short URL (e.g. `hmd.bio/abc+`). HMD.bio has a preview page (`/preview/[keyword]`) but no public stats view.

**Requirements:**
- A `/stats/[keyword]` public page showing: click count, creation date, destination URL, and a basic timeline chart
- Support the `+` suffix pattern in the proxy middleware (e.g. `hmd.bio/abc+` → `/stats/abc`)
- Gate behind a per-link or global config flag (`publicStats: boolean` on the Link model or in Options) — default OFF
- Minimal, read-only — no admin controls exposed

## 8 — API Output Formats (Low Priority)

YOURLS supports XML, JSON, JSONP, and plain text output via a `format` query parameter. HMD.bio is JSON-only.

**Requirements:**
- Accept `?format=json|xml|jsonp|simple` on public API endpoints (`/shorten`, `/expand`, `/stats`)
- `json` (default): current behavior
- `jsonp`: wrap response in callback function from `?callback=` param
- `simple`: return just the short URL as plain text (for `/shorten` and `/expand`)
- `xml`: serialize response as XML
- Implement as a shared response formatter utility, not per-endpoint logic

## 9 — Fuzzy Keyword Suggestions (Low Priority)

When a requested keyword is already taken, YOURLS suggests similar available alternatives. HMD.bio just returns an error.

**Requirements:**
- When keyword validation fails (taken), generate and return 3–5 alternative suggestions in the error response
- Strategy: append digits (abc1, abc2), append random 2-char suffix, truncate+append
- Show suggestions in the admin UI create form and in the API error response

## 10 — Sequential Keyword Option (Low Priority)

YOURLS supports sequential numeric IDs (base-36) as an alternative to random keywords. HMD.bio only generates random keywords.

**Requirements:**
- Store a `nextId` counter in the Options collection
- On link creation without a custom keyword, optionally use the next sequential ID (base-36 encoded)
- Config flag in admin settings to choose between random and sequential modes
- Must be atomic (no duplicate IDs under concurrent requests)

## 11 — Version Endpoint (Low Priority)

Useful for monitoring and integrations.

**Requirements:**
- `GET /api/v1/version` returning `{ version, node, uptime }` from `package.json` and `process.uptime()`
- No auth required

---

## Constraints

- Stack: Next.js (App Router), MUI v6, Recharts, MongoDB/Mongoose
- No new charting libraries unless the specific visualization is impossible with Recharts (exception: `react-simple-maps` for geo map is pre-approved)
- Keep the existing dark/light theme support
- All new API fields must be backward-compatible (old API consumers must not break)
- Performance: the links list must remain fast with 10,000+ links
- Do not regress any existing advantages listed in the table above

## Implementation Order

Plan and implement in this sequence — each phase should be a self-contained deliverable:

1. **Phase 1 — Click Data** (§4): expand the Click model and resolve endpoint — data foundation everything else depends on
2. **Phase 2 — Auto Title + Version** (§5, §11): quick wins that improve data quality and provide monitoring
3. **Phase 3 — Statistics** (§3): overhaul stats display to leverage the richer click data
4. **Phase 4 — Quick Edit** (§1): add inline editing and keyword rename propagation
5. **Phase 5 — List UX** (§2): polish the link list with YOURLS-style affordances
6. **Phase 6 — Bookmarklets** (§6): add the tools page with bookmarklet generators
7. **Phase 7 — Polish** (§7, §8, §9, §10): public stats page, API formats, keyword suggestions, sequential IDs
