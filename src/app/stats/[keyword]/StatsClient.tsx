"use client";

import { getCountryName } from "@/lib/countries";

interface StatsData {
  keyword: string;
  url: string;
  title: string;
  shortUrl: string;
  clicks: number;
  createdAt: string;
  timeline: { date: string; count: number }[];
  topCountries: { code: string; count: number }[];
  topReferrers: { domain: string; count: number }[];
}

export default function StatsClient({ stats }: { stats: StatsData }) {
  const maxCount = Math.max(...stats.timeline.map((t) => t.count), 1);

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Link Statistics
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Stats for{" "}
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              {stats.shortUrl}
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-6 space-y-6">
          {/* Link Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Short URL</p>
              <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                {stats.shortUrl}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Total Clicks</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {stats.clicks.toLocaleString()}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs font-medium uppercase text-gray-500">Destination</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 break-all">{stats.url}</p>
            </div>
            {stats.title && (
              <div className="col-span-2">
                <p className="text-xs font-medium uppercase text-gray-500">Title</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{stats.title}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Created</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {new Date(stats.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Timeline Chart (last 30 days) */}
          {stats.timeline.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Clicks — Last 30 Days
              </h2>
              <div className="flex items-end gap-px h-32">
                {stats.timeline.map((t) => (
                  <div
                    key={t.date}
                    className="flex-1 bg-blue-500 dark:bg-blue-400 rounded-t-sm hover:bg-blue-600 dark:hover:bg-blue-300 transition-colors relative group"
                    style={{ height: `${(t.count / maxCount) * 100}%`, minHeight: 2 }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                      {t.date}: {t.count}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Countries */}
          {stats.topCountries.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Top Countries
              </h2>
              <div className="space-y-1">
                {stats.topCountries.map((c) => (
                  <div key={c.code} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300">
                      {getCountryName(c.code) || c.code}
                    </span>
                    <span className="text-gray-500 font-medium">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Referrers */}
          {stats.topReferrers.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Top Referrers
              </h2>
              <div className="space-y-1">
                {stats.topReferrers.map((r) => (
                  <div key={r.domain} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{r.domain}</span>
                    <span className="text-gray-500 font-medium">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Continue Button */}
          <a
            href={stats.url}
            rel="noopener noreferrer"
            className="block w-full py-3 text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Continue to destination
          </a>
        </div>
      </div>
    </main>
  );
}
