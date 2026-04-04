"use client";

import { useState, useRef, useCallback, useEffect, FormEvent } from "react";
import Script from "next/script";
import Link from "next/link";
import { useSession } from "next-auth/react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (el: HTMLElement | string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const FEATURES = [
  {
    title: "Instant Shortening",
    desc: "Paste a link, get a short URL in milliseconds.",
  },
  {
    title: "Custom Keywords",
    desc: "Choose your own branded short slug.",
  },
  {
    title: "Free to Use",
    desc: "Shorten links instantly — no account required. Sign up for analytics & more.",
  },
];

export default function HomeForm() {
  const { data: session } = useSession();
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
    <>
      {/* Top nav */}
      <nav className="flex items-center justify-between mb-12">
        <Link href="/" className="text-xl font-bold text-gray-900 dark:text-white">
          HMD<span className="text-blue-600 dark:text-blue-400">.bio</span>
        </Link>
        <div className="flex items-center gap-3">
          {session ? (
            <Link
              href={session.user?.role === "admin" ? "/admin" : "/dashboard"}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero section */}
      <section className="text-center mb-12">
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          HMD<span className="text-blue-600 dark:text-blue-400">.bio</span>
        </h1>
        <p className="mt-3 text-lg text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Shorten links, track clicks, and share with confidence.
        </p>
      </section>

      {SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
          onReady={renderWidget}
        />
      )}

      {/* Shorten Form */}
      <form onSubmit={handleSubmit} className="space-y-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-lg p-6">
        <div>
          <label htmlFor="url" className="sr-only">URL to shorten</label>
          <input
            id="url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste your long URL here…"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-lg placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center flex-1 min-w-0 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <span className="text-gray-500 dark:text-gray-500 text-sm whitespace-nowrap">
              hmd.bio/
            </span>
            <label htmlFor="keyword" className="sr-only">Custom keyword</label>
            <input
              id="keyword"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="custom (optional)"
              pattern="^[a-zA-Z0-9_-]*$"
              maxLength={100}
              className="flex-1 min-w-0 bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
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
        <div role="alert" aria-live="assertive" className="mt-4 p-4 rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div role="status" aria-live="polite" className="mt-6 p-6 rounded-xl bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
          <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
            Your short URL is ready!
          </p>
          <div className="flex items-center gap-3">
            <a
              href={result.shortUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xl font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {result.shortUrl}
            </a>
            <button
              onClick={handleCopy}
              className="shrink-0 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          {result.title && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 truncate">
              {result.title}
            </p>
          )}
        </div>
      )}

      {/* Features */}
      <section className="mt-20">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-8">
          Everything you need
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="p-5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 hover:border-blue-300 dark:hover:border-blue-800 transition-colors"
            >
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                {f.title}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-20 pt-8 border-t border-gray-200 dark:border-gray-800">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-500">
          <p>
            © {new Date().getFullYear()}{" "}
            <a
              href="https://hmddevs.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 dark:text-blue-400 hover:underline"
            >
              HMD Developments
            </a>
          </p>
          <nav className="flex flex-wrap items-center gap-4" aria-label="Footer">
            <Link href="/terms" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Privacy</Link>
            <Link href="/cookies" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Cookies</Link>
            <Link href="/aup" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">AUP</Link>
            <Link href="/docs" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">API Docs</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
