"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-950">
      <div className="text-center max-w-md">
        <div className="relative inline-block mb-6">
          <span className="text-[8rem] font-black leading-none tracking-tighter text-gray-200 dark:text-gray-800 select-none">
            500
          </span>
          <span className="absolute inset-0 flex items-center justify-center text-4xl">
            ⚠️
          </span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Something went wrong
        </h1>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          An unexpected error occurred. Please try again.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={reset}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Try again
          </button>
          <a
            href="/"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Go to HMD.bio
          </a>
        </div>
      </div>
    </main>
  );
}
