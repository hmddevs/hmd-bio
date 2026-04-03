import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(`admin-clicks:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return apiError("Too many requests", 429);

  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  const url = request.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const keyword = url.searchParams.get("keyword")?.trim() || "";
  const ipFilter = url.searchParams.get("ip")?.trim() || "";
  const country = url.searchParams.get("country")?.trim() || "";
  const browser = url.searchParams.get("browser")?.trim() || "";
  const os = url.searchParams.get("os")?.trim() || "";

  await connectDB();

  const filter: Record<string, unknown> = {};
  if (keyword) filter.keyword = keyword;
  if (ipFilter) filter.ip = { $regex: ipFilter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
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

  // Look up link titles
  const keywords = [...new Set(clicks.map((c) => c.keyword))];
  const links = await Link.find({ keyword: { $in: keywords } })
    .select("keyword title url")
    .lean();
  const linkMap = Object.fromEntries(links.map((l) => [l.keyword, { title: l.title, url: l.url }]));

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
      userAgent: c.userAgent || "",
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
