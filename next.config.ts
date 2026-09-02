import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Ported from vercel.json when the app moved to Cloudflare Workers. OpenNext
  // does not read vercel.json, so anything left there is silently dropped.
  async redirects() {
    return [
      {
        source: "/:path(.*)",
        has: [{ type: "host", value: "www.hmd.bio" }],
        destination: "https://hmd.bio/:path",
        permanent: true,
      },
      { source: "/register", destination: "/signup", permanent: true },
      {
        source: "/api/v1/auth/register",
        destination: "/api/v1/auth/signup",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/preview/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=300",
          },
        ],
      },
      {
        source: "/:file(sitemap.xml|robots.txt)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, s-maxage=86400" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://*.sentry-cdn.com https://va.vercel-scripts.com https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self'",
              "connect-src 'self' https://challenges.cloudflare.com https://*.ingest.sentry.io https://va.vercel-scripts.com https://vitals.vercel-insights.com https://cloudflareinsights.com https://static.cloudflareinsights.com https://*.google-analytics.com https://stats.g.doubleclick.net",
              "frame-src https://challenges.cloudflare.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
