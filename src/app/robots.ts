import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/password/", "/preview/", "/_next/"],
      },
    ],
    sitemap: "https://hmd.bio/sitemap.xml",
  };
}
