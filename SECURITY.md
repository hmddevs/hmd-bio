# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public GitHub issue, and do not disclose the issue publicly until it has been fixed.

Email **umut@guden.tr** with:

- what the issue is, and which endpoint, route or file it affects
- the steps to reproduce it
- what an attacker could achieve with it

You should get an acknowledgement within 72 hours. Please allow a reasonable window for a fix before publishing anything.

## Scope

The live deployment at `hmd.bio` and this repository are both in scope.

Testing against the live service is acceptable only if it stays within these bounds:

- use your own account and your own links
- do not attempt to access, modify or delete other users' data
- no denial of service, load testing, or traffic floods
- no social engineering of users, staff or infrastructure providers
- no physical or network attacks on the hosting providers

Out of scope: findings that come from a scanner with no demonstrated impact, missing headers with no exploitable consequence, and reports about third-party services (Vercel, MongoDB Atlas, Upstash, Cloudflare, Resend) which should go to those vendors directly.

## Areas worth your attention

If you are looking for somewhere to start, these carry the most risk:

- **Authentication and sessions** — NextAuth v5 credentials sessions, and `hmd_*` Bearer API keys (`src/lib/auth.ts`, `src/lib/api-auth.ts`).
- **Authorisation** — ownership checks on links, domains and analytics. A user reading or mutating another user's resources is the most serious class of bug here.
- **The internal API** — `/api/internal/*` is gated by `INTERNAL_SECRET` and is called by edge middleware and cron only. It should fail closed.
- **Custom domains** — hostname validation, and the verification flow that attaches a domain to the Vercel project (`src/app/api/v1/domains/`).
- **IP handling** — visitor IPs are hashed for analytics and AES-encrypted for admin-only decryption. Raw IPs must never be logged, stored in plaintext, or returned to a non-admin. Any path that breaks this is a valid report.
- **Redirect handling** — open-redirect and protocol-smuggling variants on the short-link resolution path (`src/proxy.ts`, `src/app/[keyword]/`).

## Supported versions

This is a continuously deployed service. Only the current `main` branch and the live deployment are supported; there are no maintained release branches or backports.
