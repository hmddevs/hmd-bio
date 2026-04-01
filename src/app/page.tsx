"use client";

import { useState, useRef, useCallback, useEffect, FormEvent } from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (el: HTMLElement | string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<{
    shortUrl: string;
    keyword: string;
    title: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetRendered = useRef(false);

  const renderWidget = useCallback(() => {
    if (!SITE_KEY || !window.turnstile || !turnstileRef.current || widgetRendered.current) return;
    widgetRendered.current = true;
    window.turnstile.render(turnstileRef.current, {
      sitekey: SITE_KEY,
      theme: "auto",
      callback: (token: string) => setTurnstileToken(token),
    });
  }, []);

  useEffect(() => {
    // If script already loaded before mount
    if (window.turnstile) renderWidget();
  }, [renderWidget]);

  const resetTurnstile = useCallback(() => {
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.reset(turnstileRef.current);
    }
    setTurnstileToken("");
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          keyword: keyword || undefined,
          turnstileToken: turnstileToken || undefined,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Failed to shorten URL");
        return;
      }

      setResult(data.data);
      setUrl("");
      setKeyword("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
      resetTurnstile();
    }
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-20">
      <div className="w-full max-w-xl">
        {/* Logo & Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
            HMD<span className="text-blue-600 dark:text-blue-500">.bio</span>
          </h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            Fast, reliable URL shortening
          </p>
        </div>

        {SITE_KEY && (
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            async
            defer
            onReady={renderWidget}
          />
        )}

        {/* Shorten Form */}
        <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <div>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste your long URL here…"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-lg placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex items-center gap-2 flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <span className="text-gray-400 dark:text-gray-500 text-sm whitespace-nowrap">
                hmd.bio/
              </span>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="custom (optional)"
                pattern="^[a-zA-Z0-9_-]*$"
                maxLength={100}
                className="flex-1 bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl shadow-sm transition-colors"
            >
              {loading ? "Shortening…" : "Shorten"}
            </button>
          </div>

          {SITE_KEY && (
            <div className="flex justify-center">
              <div ref={turnstileRef} />
            </div>
          )}
        </form>

        {/* Error */}
        {error && (
          <div className="mt-4 p-4 rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mt-6 p-6 rounded-xl bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
            <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
              Your short URL is ready!
            </p>
            <div className="flex items-center gap-3">
              <a
                href={result.shortUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xl font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all"
              >
                {result.shortUrl}
              </a>
              <button
                onClick={handleCopy}
                className="shrink-0 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {result.title && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 truncate">
                {result.title}
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 text-center text-sm text-gray-400 dark:text-gray-500">
          <p>
            Powered by{" "}
            <a
              href="https://hmddevs.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 dark:text-blue-400 hover:underline"
            >
              HMD Developments
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
