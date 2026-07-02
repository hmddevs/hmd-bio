import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireOwnership } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";

function periodToDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`stats-keyword:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const { keyword } = await params;
    const period = request.nextUrl.searchParams.get("period") || "all";
    await connectDB();

    const link = await Link.findOne({ keyword }).lean();
    if (!link) {
      return apiError("Short URL not found", 404);
    }

    const forbidden = requireOwnership(link, session);
    if (forbidden) return forbidden;

    const matchFilter: Record<string, unknown> = { keyword };
    const since = periodToDate(period);
    if (since) {
      matchFilter.createdAt = { $gte: since };
    }

    const [referrers, countries, timeline, totalInPeriod, browsers, operatingSystems] =
      await Promise.all([
        Click.aggregate([
          { $match: matchFilter },
          { $group: { _id: "$referrer", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        Click.aggregate([
          { $match: matchFilter },
          { $group: { _id: "$countryCode", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Click.aggregate([
          { $match: matchFilter },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        Click.countDocuments(matchFilter),
        Click.aggregate([
          { $match: { ...matchFilter, browser: { $ne: "" } } },
          { $group: { _id: "$browser", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        Click.aggregate([
          { $match: { ...matchFilter, os: { $ne: "" } } },
          { $group: { _id: "$os", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
      ]);

    // Best day
    let bestDay: { date: string; count: number } | null = null;
    for (const t of timeline) {
      if (!bestDay || t.count > bestDay.count) {
        bestDay = { date: t._id, count: t.count };
      }
    }

    // Direct vs referred
    const directCount = referrers.find(
      (r) => r._id === "" || r._id === null
    )?.count ?? 0;
    const referredCount = totalInPeriod - directCount;
    const directPercent =
      totalInPeriod > 0
        ? Math.round((directCount / totalInPeriod) * 100)
        : 0;

    return apiSuccess({
      keyword: link.keyword,
      url: link.url,
      title: link.title,
      clicks: link.clicks,
      clicksInPeriod: totalInPeriod,
      period,
      createdAt: link.createdAt,
      bestDay,
      directCount,
      referredCount,
      directPercent,
      uniqueReferrers: referrers.filter((r) => r._id).length,
      uniqueCountries: countries.filter((c) => c._id).length,
      referrers: referrers.map((r) => ({
        referrer: r._id || "Direct",
        count: r.count,
      })),
      countries: countries.map((c) => ({
        code: c._id || "Unknown",
        count: c.count,
      })),
      timeline: timeline.map((t) => ({ date: t._id, count: t.count })),
      browsers: browsers.map((b) => ({ name: b._id || "Unknown", count: b.count })),
      operatingSystems: operatingSystems.map((o) => ({ name: o._id || "Unknown", count: o.count })),
    });
  } catch (err) {
    captureError(err, { route: "stats/[keyword]" });
    return apiError("Internal server error", 500);
  }
}
