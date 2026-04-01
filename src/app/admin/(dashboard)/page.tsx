import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";

export default async function AdminDashboard() {
  await connectDB();

  const [totalLinks, totalClicks, topLinks, recentLinks, recentActivity] =
    await Promise.all([
      Link.countDocuments(),
      Click.countDocuments(),
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

  const baseUrl = process.env.AUTH_URL || "https://hmd.bio";

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        Dashboard
      </h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Links" value={totalLinks.toLocaleString()} />
        <StatCard label="Total Clicks" value={totalClicks.toLocaleString()} />
        <StatCard
          label="Clicks (24h)"
          value={recentActivity
            .reduce((sum: number, a: { count: number }) => sum + a.count, 0)
            .toLocaleString()}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Links */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Top Links
          </h2>
          <div className="space-y-3">
            {topLinks.map((link) => (
              <div
                key={link.keyword}
                className="flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={`/admin/links/${link.keyword}`}
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {baseUrl}/{link.keyword}
                  </a>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{link.url}</p>
                </div>
                <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 ml-4">
                  {link.clicks.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Links */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Recent Links
          </h2>
          <div className="space-y-3">
            {recentLinks.map((link) => (
              <div
                key={link.keyword}
                className="flex items-center justify-between"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={`/admin/links/${link.keyword}`}
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {baseUrl}/{link.keyword}
                  </a>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    {link.title || link.url}
                  </p>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-4 whitespace-nowrap">
                  {new Date(link.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 24h Activity */}
      {recentActivity.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            24-Hour Activity
          </h2>
          <div className="flex items-end gap-1 h-32">
            {recentActivity.map(
              (point: { _id: string; count: number }, i: number) => {
                const maxCount = Math.max(
                  ...recentActivity.map((a: { count: number }) => a.count)
                );
                const height = maxCount > 0 ? (point.count / maxCount) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex-1 bg-blue-500 dark:bg-blue-600 rounded-t transition-all"
                    style={{ height: `${Math.max(height, 4)}%` }}
                    title={`${point._id}: ${point.count} clicks`}
                  />
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
        {value}
      </p>
    </div>
  );
}
