import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { authenticateRequest } from "@/lib/auth";
import { rateLimit } from "@/lib/api/rate-limit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(`user-clicks:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return apiError("Too many requests", 429);

  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);

  const url = request.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const keywordParam = url.searchParams.get("keyword")?.trim() || "";
  const country = url.searchParams.get("country")?.trim() || "";
  const browser = url.searchParams.get("browser")?.trim() || "";
  const os = url.searchParams.get("os")?.trim() || "";

  await connectDB();

  // Get keywords owned by this user
  const userLinks = await Link.find({ owner: user.id }).select("keyword title url").lean();
  const userKeywords = userLinks.map((l) => l.keyword);

  if (userKeywords.length === 0) {
    return apiSuccess({ clicks: [], total: 0, page, pages: 0 });
  }

  // Build filter scoped to user's keywords
  const filter: Record<string, unknown> = {};

  if (keywordParam) {
    // Verify the keyword belongs to this user
    if (!userKeywords.includes(keywordParam)) {
      return apiError("Forbidden", 403);
    }
    filter.keyword = keywordParam;
  } else {
    filter.keyword = { $in: userKeywords };
  }

  if (country) filter.countryCode = country.toUpperCase();
  if (browser) filter.browser = { $regex: browser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (os) filter.os = { $regex: os.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const [clicks, total] = await Promise.all([
    Click.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Click.countDocuments(filter),
  ]);

  const linkMap = Object.fromEntries(userLinks.map((l) => [l.keyword, { title: l.title, url: l.url }]));

  return apiSuccess({
    clicks: clicks.map((c) => ({
      id: c._id.toString(),
      keyword: c.keyword,
      linkTitle: linkMap[c.keyword]?.title || "",
      linkUrl: linkMap[c.keyword]?.url || "",
      createdAt: c.createdAt.toISOString(),
      ip: c.ip || "",
      countryCode: c.countryCode || "",
      browser: c.browser || "",
      os: c.os || "",
      referrer: c.referrer || "",
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
