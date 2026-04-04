# 🔗 HMD.bio

**URL Shortener & Link Management Platform**

A fast, feature-rich URL shortener with user dashboards, analytics, API access, and admin tools — built by [HMD Developments](https://hmddevs.org).

## 🌐 Live

**[hmd.bio](https://hmd.bio)**

## ✨ Features

### For Everyone
- 🔗 Shorten URLs instantly — custom or auto-generated keywords
- 🔍 Link preview pages with destination info
- 🔒 Password-protected links
- 📊 Public stats via `hmd.bio/keyword+` (owner-only metrics)
- 📄 REST API with Swagger docs at `/docs`

### For Users
- 📋 Dashboard — manage links, view analytics, generate QR codes
- 🔑 API key management (up to 5 keys per account)
- 🌍 Per-link analytics: clicks, countries (geo map), referrer domains, 30-day timeline
- 🔖 Bookmarklets for one-click shortening from any page
- ✏️ Edit links — change destination, keyword, title, status code

### For Admins
- 🛠️ Full platform management — links, users, approvals
- 📈 Global statistics and per-link deep analytics
- ⚙️ System settings — keyword mode (random / sequential), site options

### API
- 📡 Public & User tiers with Cloudflare Turnstile bot protection
- 📦 Output formats: JSON, XML, JSONP, plain text (`?format=`)
- 💡 Fuzzy keyword suggestions on conflicts (409 with alternatives)
- 🔢 Sequential keyword mode with base-62 encoding
- 📌 Version endpoint (`/api/v1/version`)

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Database | MongoDB Atlas + Mongoose |
| Cache | Upstash Redis (link resolution, rate limiting) |
| Auth | NextAuth v5 (credentials + `hmd_*` API keys) |
| UI | Material-UI v7 + Tailwind CSS v4 |
| Bot Protection | Cloudflare Turnstile |
| Email | Resend |
| Monitoring | Sentry + Vercel Analytics + Speed Insights |
| Hosting | Vercel (LHR1) |

## 🏗️ Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── admin/              # Admin dashboard (links, settings, users)
│   ├── dashboard/          # User dashboard (links, analytics, tools)
│   ├── api/v1/             # REST API (public, user, admin tiers)
│   ├── docs/               # Swagger UI
│   ├── stats/              # Link preview / owner stats
│   ├── bookmarklet/        # Bookmarklet popup
│   └── password/           # Password-protected link gate
├── components/             # React components
│   ├── admin/              # Admin shell & navigation
│   ├── dashboard/          # User shell & navigation
│   ├── providers/          # Theme & MUI providers
│   └── ui/                 # Base UI components
├── lib/                    # Core modules
│   ├── auth.ts             # Authentication helpers
│   ├── db.ts               # MongoDB connection
│   ├── rate-limit.ts       # Upstash rate limiter
│   ├── api-response.ts     # Standardised API responses
│   ├── format-response.ts  # XML/JSONP/simple formatter
│   ├── validations.ts      # Zod schemas
│   └── utils.ts            # Helpers (base62, keyword gen, title fetch)
├── models/                 # Mongoose models (Link, Click, User, Option)
├── theme/                  # MUI theme configuration
└── proxy.ts                # Edge middleware for short URL resolution
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- MongoDB (local or Atlas)

### Installation

```bash
# Clone the repository
git clone https://github.com/umutguden/hmd-bio.git
cd hmd-bio

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env.local
# Edit .env.local with your values

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

```bash
pnpm dev          # Start development server (Turbopack)
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
```

## 🔧 Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `AUTH_SECRET` | NextAuth secret (`openssl rand -base64 32`) |
| `AUTH_URL` | Canonical URL (e.g. `https://hmd.bio`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key |
| `INTERNAL_SECRET` | Secret for proxy → API internal calls |
| `IP_HASH_SALT` | Salt for hashing visitor IPs |
| `IP_ENCRYPTION_KEY` | 64-char hex key for admin IP decryption |

### Optional Environment Variables

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL (caching & rate limits) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `RESEND_API_KEY` | Resend API key for verification emails |
| `SENTRY_DSN` | Sentry error tracking |

## 🔒 Security

- **CSP** — Strict Content-Security-Policy with script/style/frame restrictions
- **HSTS** — 2-year max-age with includeSubDomains and preload
- **Headers** — X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin
- **Permissions-Policy** — Camera, microphone, geolocation blocked
- **Rate Limiting** — Per-tier limits via Upstash Redis (30/min public, 100/min authenticated)
- **Bot Protection** — Cloudflare Turnstile on all public endpoints
- **IP Privacy** — Visitor IPs are hashed before storage

## 🚢 Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

```bash
# Or deploy from CLI
vercel --prod
```

## 📄 License

[MIT](LICENSE) — [HMD Developments](https://hmddevs.org)

---

Built with care by [HMD Developments](https://hmddevs.org)
