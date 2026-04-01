import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import DashboardClient from "@/components/admin/DashboardClient";

export default async function AdminDashboard() {
  await connectDB();

  const [totalLinks, totalClicksAgg, topLinks, recentLinks, recentActivity] =
    await Promise.all([
      Link.countDocuments(),
      Link.aggregate([{ $group: { _id: null, total: { $sum: "$clicks" } } }]),
      Link.find({}).sort({ clicks: -1 }).limit(5).lean(),
      Link.find({}).sort({ createdAt: -1 }).limit(5).lean(),
      Click.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%dT%H:00:00", date: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

  const totalClicks = totalClicksAgg[0]?.total ?? 0;

  const baseUrl = process.env.AUTH_URL || "https://hmd.bio";

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
        baseUrl,
      }}
    />
  );
}
