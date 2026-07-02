import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api-response";
import { captureError } from "@/lib/errors";
import { requireAuth } from "@/lib/api-auth";

const TOP_LINKS_LIMIT = 5;
const TOP_COUNTRIES_LIMIT = 5;
const TREND_DAYS = 7;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  try {
    await connectDB();

    const links = await Link.find({ owner: session.user.id })
      .select("keyword url title clicks")
      .lean();

    const totalLinks = links.length;
    const totalClicks = links.reduce((sum, link) => sum + link.clicks, 0);
    const avgClicks = totalLinks > 0 ? Math.round(totalClicks / totalLinks) : 0;

    const topLinks = [...links]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, TOP_LINKS_LIMIT)
      .map((link) => ({
        keyword: link.keyword,
        url: link.url,
        title: link.title,
        clicks: link.clicks,
      }));

    const keywords = links.map((link) => link.keyword);

    let clicks24h = 0;
    let weeklyTrend: { date: string; count: number }[] = [];
    let topCountries: { code: string; count: number }[] = [];

    if (keywords.length > 0) {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sinceTrend = new Date(Date.now() - (TREND_DAYS - 1) * 24 * 60 * 60 * 1000);

      const [clicks24hCount, trendAgg, countriesAgg] = await Promise.all([
        Click.countDocuments({ keyword: { $in: keywords }, createdAt: { $gte: since24h } }),
        Click.aggregate([
          { $match: { keyword: { $in: keywords }, createdAt: { $gte: sinceTrend } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              count: { $sum: 1 },
            },
          },
        ]),
        Click.aggregate([
          { $match: { keyword: { $in: keywords }, countryCode: { $ne: "" } } },
          { $group: { _id: "$countryCode", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: TOP_COUNTRIES_LIMIT },
        ]),
      ]);

      clicks24h = clicks24hCount;

      const trendByDay = new Map(trendAgg.map((t) => [t._id as string, t.count as number]));
      weeklyTrend = Array.from({ length: TREND_DAYS }, (_, i) => {
        const date = new Date(sinceTrend.getTime() + i * 24 * 60 * 60 * 1000);
        const key = dayKey(date);
        return { date: key, count: trendByDay.get(key) ?? 0 };
      });

      topCountries = countriesAgg.map((c) => ({ code: c._id as string, count: c.count as number }));
    }

    return apiSuccess({
      totalLinks,
      totalClicks,
      avgClicks,
      clicks24h,
      weeklyTrend,
      topLinks,
      topCountries,
    });
  } catch (err) {
    captureError(err, { route: "GET /api/v1/user/stats" });
    return apiError("Internal server error", 500);
  }
}
