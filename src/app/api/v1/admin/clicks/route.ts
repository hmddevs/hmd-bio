import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { decryptIP } from "@/lib/ip";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimit(`admin-clicks:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
    const keyword = url.searchParams.get("keyword")?.trim() || "";
    const country = url.searchParams.get("country")?.trim() || "";
    const browser = url.searchParams.get("browser")?.trim() || "";
    const os = url.searchParams.get("os")?.trim() || "";

    await connectDB();

    // NOTE: there is no plaintext "ip" field on Click any more (see
    // src/models/Click.ts — ipRaw/ipIv is AES-256-GCM ciphertext only), so
    // the old regex-based "ip" query filter has been dropped: it can't be
    // matched against encrypted data without decrypting every row first.
    const filter: Record<string, unknown> = {};
    if (keyword) filter.keyword = keyword;
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
        // Admin-only decrypt of the AES-256-GCM ciphertext; never expose ipRaw/ipIv directly.
        ip: c.ipRaw && c.ipIv ? decryptIP(c.ipIv, c.ipRaw) : "",
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
  } catch (err) {
    captureError(err, { route: "admin/clicks:GET" });
    return apiError("Internal server error", 500);
  }
}
