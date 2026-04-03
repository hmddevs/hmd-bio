import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ keyword: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { keyword } = await params;
  await connectDB();
  const link = await Link.findOne({ keyword }).lean();
  if (!link) return { title: "Not Found" };

  return {
    title: `Preview: ${link.title || link.keyword} — HMD.bio`,
    description: `This short URL (hmd.bio/${link.keyword}) redirects to: ${link.url}`,
    robots: link.isPasswordProtected ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: link.ogTitle || link.title || `hmd.bio/${link.keyword}`,
      description: link.ogDescription || `Redirects to: ${link.url}`,
      ...(link.ogImage ? { images: [link.ogImage] } : {}),
    },
  };
}

export default async function PreviewPage({ params }: Props) {
  const { keyword } = await params;
  await connectDB();

  const link = await Link.findOne({ keyword }).lean();
  if (!link) notFound();

  const base = (process.env.AUTH_URL || "https://hmd.bio").trim().replace(/\/+$/, "");
  const shortUrl = `${base}/${link.keyword}`;

  return (
    <main id="main-content" className="flex-1 flex items-center justify-center px-4 py-16">
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
            <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-500">
              Short URL
            </p>
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">{shortUrl}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-500">
              Destination
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 break-all">
              {link.url}
            </p>
          </div>
          {link.title && (
            <div>
              <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-500">
                Title
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {link.title}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-500">
              Created
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {new Date(link.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-500">
              Clicks
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {link.clicks.toLocaleString()}
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
