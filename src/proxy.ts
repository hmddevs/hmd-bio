import { NextRequest, NextResponse } from "next/server";

const BYPASS_PREFIXES = [
  "/admin",
  "/api",
  "/_next",
  "/assets",
  "/preview",
  "/password",
  "/not-found",
  "/docs",
  "/terms",
  "/privacy",
  "/cookies",
  "/aup",
  "/register",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
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

  // Resolve via internal API (keeps MongoDB connection in API route, not Edge)
  const resolveUrl = new URL("/api/internal/resolve", request.url);
  resolveUrl.searchParams.set("keyword", keyword);

  try {
    const res = await fetch(resolveUrl.toString(), {
      headers: {
        "x-forwarded-for": request.headers.get("x-forwarded-for") || "",
        "user-agent": request.headers.get("user-agent") || "",
        referer: request.headers.get("referer") || "",
        "x-geo-country": request.headers.get("x-vercel-ip-country") || "",
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
