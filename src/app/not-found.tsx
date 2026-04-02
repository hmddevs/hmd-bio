import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-950"
    >
      <div className="text-center max-w-md">
        <div className="relative inline-block mb-6">
          <span className="text-[8rem] font-black leading-none tracking-tighter text-gray-200 dark:text-gray-800 select-none">
            404
          </span>
          <span className="absolute inset-0 flex items-center justify-center text-4xl">
            🔗
          </span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Link not found
        </h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          The short URL you followed doesn&apos;t exist, may have expired, or
          was removed.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Create a short link
          </Link>
          <Link
            href="/"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Go to HMD.bio
          </Link>
        </div>

        <p className="mt-10 text-xs text-gray-400 dark:text-gray-600">
          If you believe this is a mistake, contact the link owner.
        </p>
      </div>
    </main>
  );
}
