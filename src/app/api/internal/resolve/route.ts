import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";

/**
 * Internal resolve endpoint called by middleware.
 * Looks up a keyword, logs the click, and returns redirect info.
 */
export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return Response.json({ error: "Missing keyword" }, { status: 400 });
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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const userAgent = request.headers.get("user-agent") || "";
  const referrer = request.headers.get("referer") || "";
  const countryCode = request.headers.get("x-geo-country") || "";

  // Don't await — fire and forget
  Promise.all([
    Click.create({ keyword, referrer, userAgent, ip, countryCode }),
    Link.updateOne({ keyword }, { $inc: { clicks: 1 } }),
  ]).catch(() => {
    // Silently ignore click logging errors
  });

  return Response.json({
    url: link.url,
    statusCode: link.statusCode || 301,
    isPasswordProtected: link.isPasswordProtected,
  });
}
