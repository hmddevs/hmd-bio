"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function BookmarkletContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url") || "";
  const title = searchParams.get("title") || "";
  const keyword = searchParams.get("keyword") || "";

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [result, setResult] = useState<{ shortUrl: string; keyword: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!url) {
      // Deferred to avoid synchronous setState in effect body
      const id = requestAnimationFrame(() => {
        setError("No URL provided");
        setStatus("error");
      });
      return () => cancelAnimationFrame(id);
    }

    const body: Record<string, string> = { url };
    if (title) body.title = title;
    if (keyword) body.keyword = keyword;

    fetch("/api/v1/shorten", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setResult(data.data);
          setStatus("success");
        } else {
          setError(data.error || "Unknown error");
          setStatus("error");
        }
      })
      .catch((err) => {
        setError(err.message);
        setStatus("error");
      });
  }, [url, title, keyword]);

  const copyToClipboard = () => {
    if (result) navigator.clipboard.writeText(result.shortUrl);
  };

  return (
    <main className="flex items-center justify-center min-h-screen px-4 py-8">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-center text-gray-900 dark:text-white mb-6">
          HMD.bio — Shorten
        </h1>

        {status === "loading" && (
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-sm text-gray-500">Shortening…</p>
          </div>
        )}

        {status === "success" && result && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3 text-center">
            <p className="text-xs uppercase text-gray-500">Your short URL</p>
            <a
              href={result.shortUrl}
              className="text-lg font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {result.shortUrl}
            </a>
            <button
              onClick={copyToClipboard}
              className="block w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm"
            >
              Copy to clipboard
            </button>
            <button
              onClick={() => window.close()}
              className="block w-full py-2 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors text-sm"
            >
              Close
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-5 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <p className="mt-2 text-xs text-gray-500">Make sure you are logged in to HMD.bio</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function BookmarkletPage() {
  return (
    <Suspense
      fallback={
        <main className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </main>
      }
    >
      <BookmarkletContent />
    </Suspense>
  );
}
