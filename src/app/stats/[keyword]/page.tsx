import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import StatsClient from "./StatsClient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ keyword: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { keyword } = await params;
  await connectDB();
  const link = await Link.findOne({ keyword }).lean();
  if (!link) return { title: "Not Found" };

  return {
    title: `Stats: ${link.title || link.keyword} — HMD.bio`,
    description: `Statistics for hmd.bio/${link.keyword} → ${link.url}`,
    robots: { index: false, follow: false },
  };
}

export default async function StatsPage({ params }: Props) {
  const { keyword } = await params;
  await connectDB();

  const link = await Link.findOne({ keyword }).lean();
  if (!link) notFound();

  // Password-protected links don't show stats or preview
  if (link.isPasswordProtected) notFound();

  const base = (process.env.AUTH_URL || "https://hmd.bio").trim().replace(/\/+$/, "");
  const shortUrl = `${base}/${link.keyword}`;

  // Check if the viewer is the link owner or an admin
  const session = await auth();
  const isOwner =
    session?.user &&
    (session.user.role === "admin" ||
      (link.owner && session.user.id === link.owner.toString()));

  // Public visitors see the preview, not the stats
  if (!isOwner) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Link Preview
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              You are about to visit:
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-6 space-y-4">
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Short URL</p>
              <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                {shortUrl}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Destination</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 break-all">
                {link.url}
              </p>
            </div>
            {link.title && (
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Title</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{link.title}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Created</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {new Date(link.createdAt).toLocaleDateString()}
              </p>
            </div>
            <a
              href={link.url}
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

  // Owner / admin sees full stats
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [timeline, topCountries, topReferrers] = await Promise.all([
    Click.aggregate([
      { $match: { keyword, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Click.aggregate([
      { $match: { keyword, countryCode: { $ne: "" } } },
      { $group: { _id: "$countryCode", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    Click.aggregate([
      { $match: { keyword, referrer: { $ne: "" } } },
      { $group: { _id: "$referrer", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const stats = {
    keyword: link.keyword,
    url: link.url,
    title: link.title || "",
    shortUrl,
    clicks: link.clicks,
    createdAt: link.createdAt.toISOString(),
    timeline: timeline.map((t: { _id: string; count: number }) => ({
      date: t._id,
      count: t.count,
    })),
    topCountries: topCountries.map((c: { _id: string; count: number }) => ({
      code: c._id,
      count: c.count,
    })),
    topReferrers: topReferrers.map((r: { _id: string; count: number }) => {
      let domain = r._id;
      try { domain = new URL(r._id).hostname; } catch { /* use raw */ }
      return { domain, count: r.count };
    }),
  };

  return <StatsClient stats={stats} />;
}
