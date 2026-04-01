# Password Fix & Dashboard Overhaul — Implementation Plan

## Phase 1 — Fix Password Protection (Blocking)

1. **Fix `src/proxy.ts` syntax error** — line ~48 has `referer"` with a missing opening quote. Change to `"referer"`. This causes a runtime error whose catch block does `NextResponse.next()`, bypassing all password checks.

2. **Add `removePassword` to validation schema** — in `src/lib/validations.ts`, add `removePassword: z.boolean().optional()` to `editLinkSchema`.

3. **Handle `removePassword` in PUT handler** — in `src/app/api/v1/links/[keyword]/route.ts`, add logic so when `removePassword` is true, clear `isPasswordProtected` and `password` fields on the link document.

---

## Phase 2 — Backfill Click Logs from MySQL

4. **Get remote MySQL credentials** — need phpMyAdmin host/port (not localhost) from user.

5. **Create `scripts/backfill-clicks.ts`** — pull all rows from `yourls_hmdlog` table into MongoDB Click documents. Map columns: `click_id`, `click_time`, `shorturl` → keyword, `referrer`, `user_agent`, `ip_address`, `country_code`. Parse `user_agent` with `ua-parser-js` during import.

---

## Phase 3 — Install Dependencies

6. Run `pnpm add react-simple-maps ua-parser-js @types/react-simple-maps @types/ua-parser-js`

---

## Phase 4 — Enhance Stats API

7. **Create `src/lib/countries.ts`** — country code → country name + flag emoji mapping utility.

8. **Expand `src/app/api/v1/stats/[keyword]/route.ts`**:
   - Add `period` query param filter (24h, 7d, 30d, all-time)
   - Add "best day" stat (day with most clicks)
   - Add direct vs referred breakdown
   - Add browser and OS aggregation pipelines (parse UA strings)
   - Return richer response shape with all new groupings

---

## Phase 5 — Dashboard UI Overhaul

9. **Revamp `src/app/admin/(dashboard)/links/[keyword]/page.tsx`**:
   - **5 tabs**: Timeline, Referrers, Countries, Browser/OS, Share
   - **Timeline tab**: LineChart with period toggle (24h / 7d / 30d / all), best day highlight
   - **Referrers tab**: PieChart + list with favicons (`https://www.google.com/s2/favicons?domain=...`), direct vs referred stat
   - **Countries tab**: World map via `react-simple-maps` + country list with flag emojis and click counts
   - **Browser/OS tab**: Two side-by-side PieCharts (browser breakdown, OS breakdown)
   - **Share tab**: Keep existing share functionality
   - **Stats cards row**: Total clicks, unique referrers, unique countries, best day, direct %

---

## Known Bugs Reference

| Bug | File | Line | Root Cause |
|-----|------|------|------------|
| Password bypass | `src/proxy.ts` | ~48 | `referer"` missing opening quote → runtime error → catch does `NextResponse.next()` |
| Can't remove password | `src/lib/validations.ts` | — | `removePassword` not in `editLinkSchema` |
| Can't remove password | `src/app/api/v1/links/[keyword]/route.ts` | PUT | No `removePassword` handling |

## User Decisions

- **World map library**: `react-simple-maps`
- **Browser/OS breakdown**: Yes, via `ua-parser-js`
- **Historical click backfill**: Yes, user has MySQL access
