import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { authenticateRequest } from "@/lib/auth";
import { getCachedStats, setCachedStats } from "@/lib/integrations/cache";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);

  // Try cache first (2 min TTL per user)
  const cacheKey = `user:${user.id}`;
  const cached = await getCachedStats(cacheKey);
  if (cached) {
    return apiSuccess(cached);
  }

  await connectDB();

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Get user's link keywords first
  const userLinks = await Link.find({ owner: user.id }, { keyword: 1 }).lean();
  const keywords = userLinks.map((l) => l.keyword);

  if (keywords.length === 0) {
    return apiSuccess({
      totalLinks: 0,
      totalClicks: 0,
      avgClicks: 0,
      clicks24h: 0,
      weeklyTrend: [],
      topLinks: [],
      topCountries: [],
    });
  }

  const [
    totalLinks,
    totalClicksAgg,
    weeklyTrend,
    topLinks,
    topCountries,
    clicks24hAgg,
  ] = await Promise.all([
    Link.countDocuments({ owner: user.id }),
    Click.aggregate([
      { $match: { keyword: { $in: keywords } } },
      { $group: { _id: null, total: { $sum: 1 } } },
    ]),
    Click.aggregate([
      { $match: { keyword: { $in: keywords }, createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Link.find({ owner: user.id })
      .sort({ clicks: -1 })
      .limit(5)
      .lean(),
    Click.aggregate([
      { $match: { keyword: { $in: keywords }, countryCode: { $ne: "" } } },
      { $group: { _id: "$countryCode", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    Click.aggregate([
      { $match: { keyword: { $in: keywords }, createdAt: { $gte: twentyFourHoursAgo } } },
      { $group: { _id: null, total: { $sum: 1 } } },
    ]),
  ]);

  const totalClicks = totalClicksAgg[0]?.total ?? 0;
  const clicks24h = clicks24hAgg[0]?.total ?? 0;

  const data = {
    totalLinks,
    totalClicks,
    avgClicks: totalLinks > 0 ? Math.round((totalClicks / totalLinks) * 10) / 10 : 0,
    clicks24h,
    weeklyTrend: weeklyTrend.map((d: { _id: string; count: number }) => ({
      date: d._id,
      count: d.count,
    })),
    topLinks: topLinks.map((l) => ({
      keyword: l.keyword,
      url: l.url,
      title: l.title,
      clicks: l.clicks,
    })),
    topCountries: topCountries.map((c: { _id: string; count: number }) => ({
      code: c._id,
      count: c.count,
    })),
  };

  setCachedStats(cacheKey, data, 300).catch(() => {});

  return apiSuccess(data);
}
