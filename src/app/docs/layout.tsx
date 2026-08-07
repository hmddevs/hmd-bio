import type { Metadata } from "next";

const title = "API reference";
const description =
  "The HMD.bio REST API: shorten URLs, manage links, read analytics and attach custom domains. Copy-paste samples for curl, JavaScript and Python, with a live request playground.";

export const metadata: Metadata = {
  title,
  description,
  // These are real public docs now, so they should be indexed. The previous
  // page was a raw Swagger embed and was deliberately excluded.
  robots: { index: true, follow: true },
  alternates: { canonical: "/docs" },
  keywords: [
    "hmd.bio api",
    "url shortener api",
    "link analytics api",
    "rest api documentation",
    "openapi",
  ],
  openGraph: {
    type: "article",
    url: "https://hmd.bio/docs",
    siteName: "HMD.bio",
    title: `${title} | HMD.bio`,
    description,
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} | HMD.bio`,
    description,
    images: ["/opengraph-image"],
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
