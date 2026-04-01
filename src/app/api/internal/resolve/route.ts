import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { UAParser } from "ua-parser-js";

/**
 * Internal resolve endpoint called by middleware.
 * Looks up a keyword, logs the click, and returns redirect info.
 */
export async function GET(request: NextRequest) {
  // Only allow calls from internal middleware
  const internalSecret = process.env.INTERNAL_SECRET;
  if (internalSecret) {
    const provided = request.headers.get("x-internal-secret");
    if (provided !== internalSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const keyword = request.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return Response.json({ error: "Missing keyword" }, { status: 400 });
  }

  // Rate limit by IP: 120 requests per minute
  const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(`resolve:${clientIP}`, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  await connectDB();

  const link = await Link.findOne({ keyword }).select("+password").lean();
  if (!link) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Check expiration
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return Response.json({ error: "Link expired" }, { status: 410 });
  }

  // Log click asynchronously (fire-and-forget)
  const rawIP = clientIP;
  const userAgent = request.headers.get("user-agent") || "";
  const referrer = request.headers.get("referer") || "";
  const countryCode = request.headers.get("x-geo-country") || "";

  const ua = UAParser(userAgent);
  const browser = ua.browser.name || "";
  const os = ua.os.name || "";

  // Don't await — fire and forget
  Promise.all([
    Click.create({
      keyword,
      referrer,
      userAgent,
      ip: hashIP(rawIP),
      countryCode,
      browser,
      os,
    }),
    Link.updateOne({ keyword }, { $inc: { clicks: 1 } }),
  ]).catch((err) => {
    console.error("Click logging error:", err);
  });

  return Response.json({
    url: link.url,
    statusCode: link.statusCode || 301,
    isPasswordProtected: link.isPasswordProtected,
  });
}
