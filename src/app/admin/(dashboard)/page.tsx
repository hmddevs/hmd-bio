import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import DashboardClient from "@/components/admin/DashboardClient";

export default async function AdminDashboard() {
  await connectDB();

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    totalLinks,
    totalClicksAgg,
    topLinks,
    recentLinks,
    recentActivity,
    weeklyTrend,
    monthlyTrend,
    quarterlyTrend,
    topCountries,
    linksCreatedLast7d,
    activeLinks,
    expiredLinks,
    avgClicksAgg,
    recentClicks,
  ] = await Promise.all([
    Link.countDocuments(),
    Link.aggregate([{ $group: { _id: null, total: { $sum: "$clicks" } } }]),
    Link.find({}).sort({ clicks: -1 }).limit(5).lean(),
    Link.find({}).sort({ createdAt: -1 }).limit(5).lean(),
    Click.aggregate([
      { $match: { createdAt: { $gte: twentyFourHoursAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%dT%H:00:00", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // 7-day daily trend for sparkline
    Click.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // 30-day daily trend
    Click.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // 90-day weekly trend
    Click.aggregate([
      { $match: { createdAt: { $gte: ninetyDaysAgo } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: { $dateTrunc: { date: "$createdAt", unit: "week" } },
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Top 5 countries globally
    Click.aggregate([
      { $match: { countryCode: { $ne: "" } } },
      { $group: { _id: "$countryCode", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    // Links created in last 7 days
    Link.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
    // Active links (no expiry or not yet expired)
    Link.countDocuments({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }),
    // Expired links
    Link.countDocuments({ expiresAt: { $lte: now } }),
    // Average clicks per link
    Link.aggregate([{ $group: { _id: null, avg: { $avg: "$clicks" } } }]),
    // 5 most recent clicks
    Click.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .select("keyword createdAt ip countryCode browser os referrer")
      .lean(),
  ]);

  const totalClicks = totalClicksAgg[0]?.total ?? 0;
  const avgClicks = Math.round((avgClicksAgg[0]?.avg ?? 0) * 10) / 10;
  const baseUrl = (process.env.AUTH_URL || "https://hmd.bio").trim().replace(/\/+$/, "");

  return (
    <DashboardClient
      data={{
        totalLinks,
        totalClicks,
        topLinks: topLinks.map((l) => ({
          keyword: l.keyword,
          url: l.url,
          title: l.title,
          clicks: l.clicks,
        })),
        recentLinks: recentLinks.map((l) => ({
          keyword: l.keyword,
          url: l.url,
          title: l.title,
          createdAt: l.createdAt.toISOString(),
        })),
        recentActivity,
        weeklyTrend: weeklyTrend.map((d: { _id: string; count: number }) => ({
          date: d._id,
          count: d.count,
        })),
        monthlyTrend: monthlyTrend.map((d: { _id: string; count: number }) => ({
          date: d._id,
          count: d.count,
        })),
        quarterlyTrend: quarterlyTrend.map((d: { _id: string; count: number }) => ({
          date: d._id,
          count: d.count,
        })),
        topCountries: topCountries.map((c: { _id: string; count: number }) => ({
          code: c._id,
          count: c.count,
        })),
        linksCreatedLast7d,
        activeLinks,
        expiredLinks,
        avgClicks,
        baseUrl,
        recentClicks: recentClicks.map((c) => ({
          keyword: c.keyword,
          createdAt: c.createdAt.toISOString(),
          ip: c.ip || "",
          countryCode: c.countryCode || "",
          browser: c.browser || "",
          os: c.os || "",
          referrer: c.referrer || "",
        })),
      }}
    />
  );
}
