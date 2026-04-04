import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import StatsClient from "./StatsClient";

export const revalidate = 300; // ISR: 5 min

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

export default async function PublicStatsPage({ params }: Props) {
  const { keyword } = await params;
  await connectDB();

  const link = await Link.findOne({ keyword }).lean();
  if (!link) notFound();

  // Password-protected links don't show public stats
  if (link.isPasswordProtected) notFound();

  const base = (process.env.AUTH_URL || "https://hmd.bio").trim().replace(/\/+$/, "");
  const shortUrl = `${base}/${link.keyword}`;

  // Aggregate basic stats (last 30 days timeline)
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
