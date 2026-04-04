import { NextRequest, NextResponse } from "next/server";
import { getCachedLink } from "@/lib/cache";

const BYPASS_PREFIXES = [
  "/admin",
  "/api",
  "/dashboard",
  "/docs",
  "/login",
  "/signup",
  "/preview",
  "/password",
  "/not-found",
  "/terms",
  "/privacy",
  "/cookies",
  "/aup",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip non-shorturl paths
  if (BYPASS_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === "/") {
    return NextResponse.next();
  }

  // Check for preview suffix (keyword+)
  const isPreview = pathname.endsWith("+");
  const keyword = isPreview
    ? pathname.slice(1, -1)
    : pathname.slice(1);

  // Skip if keyword is empty or looks like a file
  if (!keyword || keyword.includes(".")) {
    return NextResponse.next();
  }

  // Preview pages don't need resolution — rewrite directly (no click logged)
  if (isPreview) {
    const previewUrl = new URL(`/preview/${keyword}`, request.url);
    return NextResponse.rewrite(previewUrl);
  }

  // Collect request metadata for click logging
  const ip = request.headers.get("x-forwarded-for") || "";
  const userAgent = request.headers.get("user-agent") || "";
  const referrer = request.headers.get("referer") || "";
  const countryCode = request.headers.get("x-vercel-ip-country") || "";

  // ── Fast path: try Redis cache first (edge-compatible, ~1ms) ──
  try {
    const cached = await getCachedLink(keyword);
    if (cached) {
      if (cached.isPasswordProtected) {
        const passwordUrl = new URL(`/password/${keyword}`, request.url);
        return NextResponse.rewrite(passwordUrl);
      }

      // Fire-and-forget click logging (don't await)
      const logUrl = new URL("/api/internal/log-click", request.url);
      fetch(logUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.INTERNAL_SECRET || "",
        },
        body: JSON.stringify({ keyword, ip, userAgent, referrer, countryCode }),
      }).catch(() => {});

      return NextResponse.redirect(cached.url, cached.statusCode || 301);
    }
  } catch {
    // Redis unavailable — fall through to internal API
  }

  // ── Slow path: resolve via internal API (MongoDB) ──
  const resolveUrl = new URL("/api/internal/resolve", request.url);
  resolveUrl.searchParams.set("keyword", keyword);

  try {
    const res = await fetch(resolveUrl.toString(), {
      headers: {
        "x-forwarded-for": ip,
        "user-agent": userAgent,
        referer: referrer,
        "x-geo-country": countryCode,
        "x-internal-secret": process.env.INTERNAL_SECRET || "",
      },
    });

    if (!res.ok) {
      const notFoundUrl = new URL("/not-found", request.url);
      return NextResponse.rewrite(notFoundUrl);
    }

    const data = await res.json();

    if (data.isPasswordProtected) {
      const passwordUrl = new URL(`/password/${keyword}`, request.url);
      return NextResponse.rewrite(passwordUrl);
    }

    return NextResponse.redirect(data.url, data.statusCode || 301);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    /*
     * Match short-link paths only: single path segment, no dots (excludes files).
     * Excludes: /_next, /api, /admin, /dashboard, /docs, /login, /signup,
     * /preview, /password, /not-found, /(legal pages), static files.
     */
    "/((?!_next|api|admin|dashboard|docs|login|signup|preview|password|not-found|terms|privacy|cookies|aup|assets|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|icon|apple-icon|opengraph-image).*)",
  ],
};
