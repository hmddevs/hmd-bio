---
description: "Implement full SEO, speed, and accessibility overhaul for hmd.bio — robots.txt, sitemap, metadata, favicons, OG images, CSP fix, noindex, a11y, JSON-LD, Vercel Analytics"
---

# SEO, Speed & Accessibility — Full Implementation

Implement all changes below in order. Read the Next.js 16 docs at `node_modules/next/dist/docs/` before writing code — especially the metadata, viewport, robots, sitemap, manifest, and app-icons references.

**Domain:** `https://hmd.bio`
**Stack:** Next.js 16 on Vercel Pro + Cloudflare DNS, MongoDB, Tailwind 4

## Context Files

- Root layout: [layout.tsx](../../src/app/layout.tsx)
- Homepage: [page.tsx](../../src/app/page.tsx)
- Not-found: [not-found.tsx](../../src/app/not-found.tsx)
- Preview page: [preview/\[keyword\]/page.tsx](../../src/app/preview/[keyword]/page.tsx)
- Password page: [password/\[keyword\]/page.tsx](../../src/app/password/[keyword]/page.tsx)
- Admin layout: [admin/(dashboard)/layout.tsx](../../src/app/admin/(dashboard)/layout.tsx)
- Admin login: [admin/login/page.tsx](../../src/app/admin/login/page.tsx)
- Proxy/middleware: [proxy.ts](../../src/proxy.ts)
- Next config: [next.config.ts](../../next.config.ts)
- Vercel config: [vercel.json](../../vercel.json)
- Globals CSS: [globals.css](../../src/app/globals.css)
- Package: [package.json](../../package.json)

---

## Phase 1 — Homepage Server Component Split (P0)

The homepage (`src/app/page.tsx`) is `"use client"` which blocks all server-side metadata. Fix this:

1. **Create `src/app/HomeForm.tsx`** — move ALL client logic (useState, Turnstile, form, result display) from `page.tsx` into this new `"use client"` component. Export it as `default` or named `HomeForm`.

2. **Rewrite `src/app/page.tsx`** as a Server Component:
   - Remove `"use client"`
   - Export `metadata` with homepage-specific title and description
   - Render `<HomeForm />` as child
   - Add JSON-LD `<script type="application/ld+json">` for `WebApplication` schema (see Phase 6)

The visual output must be **identical** — no UI changes, just the structural split.

---

## Phase 2 — Root Layout Metadata (P0)

Update `src/app/layout.tsx`:

1. **Add `metadataBase`**: `new URL("https://hmd.bio")`

2. **Upgrade `metadata` export** to include:
   - `title.default` and `title.template` (`"%s | HMD.bio"`)
   - `description`: `"Fast, reliable URL shortening by HMD Developments. Create short, branded links instantly."`
   - `keywords`: `["url shortener", "link shortener", "short url", "hmd.bio", "branded links", "custom short links"]`
   - `authors`: `[{ name: "HMD Developments", url: "https://hmddevs.org" }]`
   - `creator` and `publisher`: `"HMD Developments"`
   - `robots`: `{ index: true, follow: true }`
   - `openGraph` with `type: "website"`, `locale: "en_US"`, `url`, `siteName`, `images` array pointing to `/og-image.png` (1200×630)
   - `twitter` with `card: "summary_large_image"`, `images`

3. **Add `viewport` export** (separate from metadata per Next.js 16):
   ```ts
   export const viewport: Viewport = {
     themeColor: [
       { media: "(prefers-color-scheme: light)", color: "#fafafa" },
       { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
     ],
     width: "device-width",
     initialScale: 1,
   };
   ```

4. **Add DNS prefetch hints** inside a `<head>` tag in the `<html>`:
   ```tsx
   <head>
     <link rel="dns-prefetch" href="https://challenges.cloudflare.com" />
     <link rel="preconnect" href="https://challenges.cloudflare.com" crossOrigin="anonymous" />
   </head>
   ```

5. **Add Vercel Analytics and Speed Insights** (already in `package.json` but never rendered):
   ```tsx
   import { Analytics } from "@vercel/analytics/react";
   import { SpeedInsights } from "@vercel/speed-insights/next";
   // Inside <body>, after {children}:
   <Analytics />
   <SpeedInsights />
   ```
   Install `@vercel/speed-insights` if missing: `pnpm add @vercel/speed-insights`

6. **Add skip navigation link** for accessibility:
   ```tsx
   <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg">
     Skip to main content
   </a>
   ```
   Ensure all page `<main>` elements have `id="main-content"`.

---

## Phase 3 — robots.ts + sitemap.ts (P0)

1. **Create `src/app/robots.ts`**:
   ```ts
   import type { MetadataRoute } from "next";

   export default function robots(): MetadataRoute.Robots {
     return {
       rules: [
         {
           userAgent: "*",
           allow: "/",
           disallow: ["/admin/", "/api/", "/password/", "/preview/", "/_next/"],
         },
       ],
       sitemap: "https://hmd.bio/sitemap.xml",
     };
   }
   ```

2. **Create `src/app/sitemap.ts`**:
   ```ts
   import type { MetadataRoute } from "next";

   export default function sitemap(): MetadataRoute.Sitemap {
     return [
       {
         url: "https://hmd.bio",
         lastModified: new Date(),
         changeFrequency: "monthly",
         priority: 1.0,
       },
     ];
   }
   ```

---

## Phase 4 — Favicons, Icons & OG Image (P1)

Generate icons programmatically using `ImageResponse` from `next/og` — no external asset files needed.

1. **Create `src/app/icon.tsx`** — 32×32 PNG favicon. Blue (#2563eb) rounded square with white "H" text.

2. **Create `src/app/apple-icon.tsx`** — 180×180 PNG. Same design, larger.

3. **Create `src/app/opengraph-image.tsx`** — 1200×630 PNG. Dark background (#0a0a0a), large "HMD.bio" text, subtitle "Fast, reliable URL shortening", "by HMD Developments" at bottom.

4. **Create `src/app/manifest.ts`**:
   ```ts
   import type { MetadataRoute } from "next";

   export default function manifest(): MetadataRoute.Manifest {
     return {
       name: "HMD.bio — URL Shortener",
       short_name: "HMD.bio",
       description: "Fast, reliable URL shortening by HMD Developments",
       start_url: "/",
       display: "standalone",
       background_color: "#fafafa",
       theme_color: "#2563eb",
       icons: [
         { src: "/icon", sizes: "32x32", type: "image/png" },
       ],
     };
   }
   ```

---

## Phase 5 — noindex Non-Public Pages (P1)

1. **Preview page** — in `src/app/preview/[keyword]/page.tsx`, add to `generateMetadata` return:
   ```ts
   robots: { index: false, follow: false },
   ```

2. **Password pages** — create `src/app/password/layout.tsx`:
   ```ts
   import type { Metadata } from "next";
   export const metadata: Metadata = { robots: { index: false, follow: false } };
   export default function Layout({ children }: { children: React.ReactNode }) { return children; }
   ```

3. **Admin layout** — add to `src/app/admin/(dashboard)/layout.tsx`:
   ```ts
   import type { Metadata } from "next";
   export const metadata: Metadata = { robots: { index: false, follow: false } };
   ```

4. **Admin login** — create `src/app/admin/login/layout.tsx` with the same `noindex` metadata pattern.

5. **Not-found page** — add metadata export to `src/app/not-found.tsx`:
   ```ts
   export const metadata: Metadata = {
     title: "Page Not Found",
     robots: { index: false, follow: false },
   };
   ```

---

## Phase 6 — Fix CSP in next.config.ts (P0)

The current Content-Security-Policy blocks Cloudflare Turnstile, Sentry, and Vercel Analytics — they silently fail.

**Update the CSP value in `next.config.ts`:**

```ts
value: [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://*.sentry-cdn.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com https://*.ingest.sentry.io https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
].join("; "),
```

Also add this header to the headers array:
```ts
{ key: "X-DNS-Prefetch-Control", value: "on" },
```

---

## Phase 7 — Accessibility Fixes (P1)

### 7.1 Homepage form (in `HomeForm.tsx`)

- Add `<label htmlFor="url" className="sr-only">URL to shorten</label>` before URL input
- Add `id="url"` to the URL input
- Add `<label htmlFor="keyword" className="sr-only">Custom keyword</label>` before keyword input
- Add `id="keyword"` to the keyword input
- Wrap error display in `<div role="alert" aria-live="assertive">`
- Wrap result display in `<div role="status" aria-live="polite">`

### 7.2 Color contrast

Replace all instances of `text-gray-400` used for body-size text with `text-gray-500` minimum. `text-gray-400` on white (#fafafa) fails WCAG AA. Only use `text-gray-400` for large/decorative text. Check:
- Homepage subtitle/footer
- Preview page labels
- Password page text

### 7.3 Focus indicators

Ensure all `<button>` and `<a>` elements have `focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2` or equivalent outline.

### 7.4 ThemeToggle

Add `aria-label="Toggle dark mode"` to the theme toggle button in `src/components/ui/ThemeToggle.tsx`.

### 7.5 `<main>` landmarks

Add `id="main-content"` to every `<main>` element across all public pages (homepage, not-found, preview, password).

---

## Phase 8 — JSON-LD Structured Data (P2)

In the rewritten `src/app/page.tsx` (server component), add before `<HomeForm />`:

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "HMD.bio",
      url: "https://hmd.bio",
      description: "Fast, reliable URL shortening service by HMD Developments",
      applicationCategory: "UtilityApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      provider: {
        "@type": "Organization",
        name: "HMD Developments",
        url: "https://hmddevs.org",
      },
    }),
  }}
/>
```

---

## Phase 9 — Vercel & Caching Config (P2)

Update `vercel.json` to add caching headers for static assets:

```json
{
  "framework": "nextjs",
  "regions": ["lhr1"],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "no-store" }]
    },
    {
      "source": "/(favicon\\.ico|icon|apple-icon|opengraph-image)(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(sitemap\\.xml|robots\\.txt)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=86400, s-maxage=86400" }
      ]
    }
  ]
}
```

---

## Verification Checklist

After implementation, verify:

- [ ] `curl -s https://hmd.bio | grep '<title>'` shows correct title
- [ ] `curl -s https://hmd.bio | grep 'og:'` shows OG tags
- [ ] `curl -s https://hmd.bio | grep 'twitter:'` shows Twitter card
- [ ] `curl -s https://hmd.bio | grep 'application/ld+json'` shows JSON-LD
- [ ] `curl -s https://hmd.bio/robots.txt` returns valid robots file
- [ ] `curl -s https://hmd.bio/sitemap.xml` returns valid sitemap
- [ ] `curl -s https://hmd.bio/icon` returns PNG favicon
- [ ] `curl -s https://hmd.bio/manifest.webmanifest` returns manifest
- [ ] Preview pages have `<meta name="robots" content="noindex, nofollow">`
- [ ] Admin pages have `<meta name="robots" content="noindex, nofollow">`
- [ ] Turnstile widget renders (CSP no longer blocks it)
- [ ] Sentry errors reach dashboard (CSP no longer blocks it)
- [ ] `pnpm build` succeeds with no errors
- [ ] Lighthouse SEO score ≥ 95
- [ ] Lighthouse Accessibility score ≥ 95
