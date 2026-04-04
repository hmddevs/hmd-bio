# HMD.bio

URL shortener by [HMD Developments](https://hmddevs.org). Production at [hmd.bio](https://hmd.bio).

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Database:** MongoDB Atlas + Mongoose
- **Cache:** Upstash Redis (link resolution, rate limiting)
- **Auth:** NextAuth v5 (credentials + API keys)
- **UI:** MUI v7 + Tailwind CSS v4
- **Monitoring:** Sentry, Vercel Analytics
- **Bot protection:** Cloudflare Turnstile
- **Deployment:** Vercel (LHR1)

## Features

- Shorten URLs with custom or random keywords
- User dashboard (links, analytics, API keys, QR codes)
- Admin panel (link management, user approvals, global stats)
- Per-link stats: clicks over time, countries (geo map), referrers
- API with Public / User tiers, Swagger docs at `/docs`
- Password-protected links, link previews
- Bookmarklets for quick shortening
- XML/JSONP/plain-text API output formats
- Sequential keyword mode (base-62)
- Fuzzy keyword suggestions on conflict

## Getting Started

```bash
# Install dependencies
pnpm install

# Copy env and fill in values
cp .env.example .env.local

# Run dev server
pnpm dev
```

Required environment variables are documented in `.env.example`.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |

## Project Structure

```
src/
├── app/            # Next.js App Router pages & API routes
│   ├── admin/      # Admin dashboard
│   ├── dashboard/  # User dashboard
│   ├── api/v1/     # REST API (public, user, admin tiers)
│   ├── docs/       # Swagger UI
│   └── stats/      # Public link preview / owner stats
├── components/     # React components (admin, dashboard, UI)
├── lib/            # Utilities (auth, db, cache, validation)
├── models/         # Mongoose models (Link, Click, User, Option)
└── proxy.ts        # Edge middleware for short URL resolution
```

## License

Proprietary — HMD Developments. All rights reserved.
