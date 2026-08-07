import type { MetadataRoute } from "next";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { PRIMARY_DOMAIN } from "@/lib/domains";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connectDB();

  // Primary-domain links only. A tenant's links live on their own hostname and
  // do not belong in this site's sitemap.
  const links = await Link.find(
    { domain: PRIMARY_DOMAIN, isPasswordProtected: false },
    { keyword: 1, updatedAt: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(5000)
    .lean();

  const linkEntries: MetadataRoute.Sitemap = links.map((l) => ({
    url: `https://hmd.bio/preview/${l.keyword}`,
    lastModified: l.updatedAt ?? new Date(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [
    {
      url: "https://hmd.bio",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: "https://hmd.bio/terms",
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: "https://hmd.bio/privacy",
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: "https://hmd.bio/cookies",
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: "https://hmd.bio/aup",
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...linkEntries,
  ];
}
