# HMD.bio

**URL Shortener & Link Analytics Platform**

A URL shortener with owner dashboards, click analytics, a REST API and an admin area. Built by [HMD Developments](https://hmddevs.org). Live since May 2023; rebuilt from the ground up in 2026 with a modern stack.

## Live

**[hmd.bio](https://hmd.bio)**

## Features

### For everyone
- Shorten URLs instantly: custom or auto-generated keywords
- Link preview pages (`hmd.bio/keyword+`) showing destination, title and creation date
- Password-protected links (bcrypt-hashed, unlocked via a dedicated `/password/[keyword]` gate)
- REST API with interactive Swagger docs at `/docs`

### For registered users
- Signup with email verification (`/signup`, verification link via Resend; admin notified of the new pending account)
- Dashboard for creating and managing links (`/dashboard`, `/dashboard/links`, `/dashboard/links/[keyword]`)
- Per-link analytics: clicks over time, referrers, countries, browsers, operating systems, direct-vs-referred split
- QR code generation for any owned link
- Bulk link import via the API
- CSV export of owned links (streamed, so large accounts don't time out)
- API key management (create/list/revoke `hmd_*` Bearer keys tied to the account)
- Account settings page (`/dashboard/settings`) and additional dashboard tools (`/dashboard/tools`)
- Per-account click log (`/dashboard/clicks`)
- Bookmarklet for one-click shortening from any page (`/bookmarklet`)
- Own-password change endpoint

### For admins
- Admin dashboard (`/admin`) for reviewing all links and site-wide settings
- Per-link deep analytics with a country map
- Admin user management (`/admin/users`): search, review and manage registered accounts

## Roadmap / planned features

Worth considering later:
- Redis-backed link cache on the hot redirect path (a fast-path placeholder was pulled from `proxy.ts` pending a proper design)
- Scheduled CSV/JSON bulk export
- Custom domain support
- Link expiration reminders via Resend
- Webhook notifications on click milestones
- Admin audit log

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| Database | MongoDB Atlas + Mongoose 9 |
| Cache | Upstash Redis (rate limiting; optional, degrades gracefully) |
| Auth | NextAuth v5 beta (credentials sessions + `hmd_*` Bearer API keys) |
| UI | MUI v7 + Tailwind CSS v4 |
| Bot Protection | Cloudflare Turnstile |
| Email | Resend |
| Monitoring | Sentry 10 |
| Hosting | Vercel (lhr1) |

## Project Structure

```
src/
├── app/
│   ├── (auth)/              # Login/signup route group
│   ├── (legal)/             # Terms, privacy, cookies, AUP route group
│   ├── admin/                # Admin dashboard, login, user management
│   ├── dashboard/            # User dashboard (links, settings, clicks, tools)
│   ├── bookmarklet/           # One-click shortening bookmarklet target
│   ├── docs/                 # Swagger UI, backed by src/lib/openapi.ts
│   ├── api/
│   │   ├── v1/                # Public REST API (see below)
│   │   ├── internal/           # INTERNAL_SECRET-gated routes, called by proxy.ts only
│   │   ├── admin/               # Admin-only server actions/routes
│   │   └── auth/[...nextauth]/  # NextAuth handler
│   ├── [keyword]/            # Catch-all short URL redirect target (see proxy.ts)
│   ├── stats/[keyword]/      # Owner-facing stats page
│   ├── preview/[keyword]/    # Link preview page
│   └── password/[keyword]/   # Password-protected link gate
├── lib/                     # auth.ts, db.ts, rate-limit.ts, api-response.ts, ip.ts, openapi.ts, validations.ts, utils.ts
├── models/                  # Mongoose schemas (Link, Click, User, Option, ...)
└── proxy.ts                 # Edge middleware: resolves short URLs via /api/internal/resolve
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- MongoDB (local or Atlas)

### Installation

```bash
git clone https://github.com/hmddevs/hmd-bio.git
cd hmd-bio
pnpm install
cp .env.example .env.local
# Edit .env.local with your values
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

```bash
pnpm dev          # Start development server (Turbopack)
pnpm build        # Production build + Sentry source map upload
pnpm lint         # ESLint (eslint-config-next)
npx tsc --noEmit  # Typecheck (no test suite defined)
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `AUTH_SECRET` | NextAuth secret (`openssl rand -base64 32`) |
| `AUTH_URL` | Canonical URL (e.g. `https://hmd.bio`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key |
| `INTERNAL_SECRET` | Secret gating `/api/internal/*`; those routes fail closed if unset |
| `IP_HASH_SALT` | Salt for hashing visitor IPs before analytics storage |
| `IP_ENCRYPTION_KEY` | 64-char hex key for admin-only raw IP decryption |

### Optional Environment Variables

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis (rate limiting). Absent: rate limiting falls back to a per-instance in-memory limiter; redirects and the API keep working. |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `SENTRY_DSN` | Sentry error tracking |
| `ADMIN_EMAIL` | Admin notification address |

## API

Base URL: `https://hmd.bio/api/v1`. All responses are JSON, shaped as `{ success, data?, error?, statusCode }`.

### Authentication

- **Session cookie** — for browser-driven calls from the dashboard.
- **Bearer API key** — `Authorization: Bearer hmd_<key>`, issued and revoked from `/dashboard` via `POST/GET/DELETE /api/v1/auth/api-keys`. Keys are stored hashed; the raw value is shown once, at creation.

Public endpoints (`/shorten`, `/expand`, `/stats`) accept either an authenticated caller or none; authenticated endpoints (link management, per-link stats, exports, API keys) require a session or API key and return `401` otherwise.

### Rate limits

Upstash-backed sliding window, per caller:

| Tier | Limit |
|------|-------|
| Public (unauthenticated) | 30 requests/minute |
| Authenticated (session or API key) | 100 requests/minute |

A `429` is returned once the limit is exceeded. If Upstash is unreachable, requests still get rate-limited via an in-memory fallback rather than being left unlimited.

### Example requests

Shorten a URL (public, Turnstile-protected):

```bash
curl -X POST https://hmd.bio/api/v1/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/very/long/path", "turnstileToken": "<token>"}'
```

Expand a short URL:

```bash
curl "https://hmd.bio/api/v1/expand?keyword=abc123"
```

Fetch analytics for an owned link (requires auth):

```bash
curl "https://hmd.bio/api/v1/stats/abc123?period=7d" \
  -H "Authorization: Bearer hmd_<your-key>"
```

For the full set of endpoints, request/response schemas, and error codes, see the Swagger UI at [`/docs`](https://hmd.bio/docs) (backed by `src/lib/openapi.ts`).

## Security

- **CSP**: strict Content-Security-Policy with script/style/frame restrictions
- **HSTS**: 2-year max-age with includeSubDomains and preload
- **Headers**: X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin
- **Permissions-Policy**: camera, microphone, geolocation blocked
- **Rate limiting**: per-tier limits via Upstash Redis, degrading to an in-memory fallback if Redis is unavailable
- **Bot protection**: Cloudflare Turnstile on public write endpoints
- **IP privacy**: visitor IPs are hashed for analytics and AES-encrypted for admin-only decryption; raw IPs are never logged

## Deployment

### Vercel

1. Push to GitHub
2. Import the project in Vercel
3. Add environment variables
4. Deploy

```bash
vercel --prod
```

## License

[MIT](LICENSE)

---

Built by [HMD Developments](https://hmddevs.org)
