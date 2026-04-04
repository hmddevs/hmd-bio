import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { rateLimit } from "@/lib/api/rate-limit";
import { authenticateRequest } from "@/lib/auth";
import { getCachedStats, setCachedStats } from "@/lib/integrations/cache";
import { formatResponse } from "@/lib/api/format-response";

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return apiError("Unauthorized — API key required", 401);
    }

    // Rate limit: 60 req/min per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = rateLimit(`stats:${ip}`, { limit: 60, windowMs: 60_000 });
    if (!rl.allowed) {
      return apiError("Rate limit exceeded. Try again later.", 429);
    }

    // Try cache first (5 min TTL)
    const cacheKey = "global";
    const cached = await getCachedStats<{ totalLinks: number; totalClicks: number }>(cacheKey);
    if (cached) {
      return apiSuccess(cached);
    }

    await connectDB();

    const [totalLinks, totalClicksAgg] = await Promise.all([
      Link.countDocuments(),
      Link.aggregate([{ $group: { _id: null, total: { $sum: "$clicks" } } }]),
    ]);

    const totalClicks = totalClicksAgg[0]?.total ?? 0;
    const data = { totalLinks, totalClicks };

    setCachedStats(cacheKey, data, 300).catch(() => {});

    const format = request.nextUrl.searchParams.get("format");
    if (format && format !== "json") {
      const cb = request.nextUrl.searchParams.get("callback");
      return formatResponse(data, format, 200, cb);
    }

    return apiSuccess(data);
  } catch (err) {
    console.error("Stats error:", err);
    return apiError("Internal server error", 500);
  }
}
