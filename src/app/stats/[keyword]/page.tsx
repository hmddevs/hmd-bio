"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface StatsData {
  keyword: string;
  url: string;
  title?: string;
  clicks: number;
  clicksInPeriod: number;
  period: string;
  createdAt: string;
  bestDay: { date: string; count: number } | null;
  directCount: number;
  referredCount: number;
  directPercent: number;
  uniqueReferrers: number;
  uniqueCountries: number;
  referrers: { referrer: string; count: number }[];
  countries: { code: string; count: number }[];
  timeline: { date: string; count: number }[];
  browsers: { name: string; count: number }[];
  operatingSystems: { name: string; count: number }[];
}

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StatsData };

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const width = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700 dark:text-gray-300 truncate pr-2">{label}</span>
        <span className="text-gray-500 dark:text-gray-400 shrink-0">{count.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function StatsPage({ params }: { params: Promise<{ keyword: string }> }) {
  const { keyword } = use(params);
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState({ status: "loading" });
      try {
        const res = await fetch(`/api/v1/stats/${keyword}`);
        if (cancelled) return;

        if (res.status === 401) {
          router.push(`/login?callbackUrl=${encodeURIComponent(`/stats/${keyword}`)}`);
          return;
        }
        if (res.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (res.status === 404) {
          setState({ status: "not-found" });
          return;
        }

        const json = await res.json();
        if (!res.ok || !json.success) {
          setState({ status: "error", message: json.error || "Failed to load stats" });
          return;
        }
        setState({ status: "ready", data: json.data });
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Failed to load stats" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [keyword, router]);

  if (state.status === "loading") {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading stats…</p>
      </main>
    );
  }

  if (state.status === "forbidden") {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Access denied</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            You don&apos;t own hmd.bio/{keyword}, so its stats aren&apos;t visible to you.
          </p>
        </div>
      </main>
    );
  }

  if (state.status === "not-found") {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Not found</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            hmd.bio/{keyword} doesn&apos;t exist.
          </p>
        </div>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{state.message}</p>
        </div>
      </main>
    );
  }

  const data = state.data;
  const maxReferrer = data.referrers[0]?.count ?? 1;
  const maxCountry = data.countries[0]?.count ?? 1;
  const maxBrowser = data.browsers[0]?.count ?? 1;
  const maxOs = data.operatingSystems[0]?.count ?? 1;

  return (
    <main id="main-content" className="flex-1 px-4 py-12">
      <div className="w-full max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            hmd.bio/{data.keyword}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 break-all">
            {data.title || data.url}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total clicks", value: data.clicks },
            { label: "Clicks (period)", value: data.clicksInPeriod },
            { label: "Unique referrers", value: data.uniqueReferrers },
            { label: "Unique countries", value: data.uniqueCountries },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
            >
              <p className="text-xs uppercase text-gray-500 dark:text-gray-500">{s.label}</p>
              <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                {s.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Direct vs. referred
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {data.directPercent}% direct ({data.directCount.toLocaleString()}), {data.referredCount.toLocaleString()} referred
            </p>
            {data.bestDay && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                Best day: {data.bestDay.date} ({data.bestDay.count.toLocaleString()} clicks)
              </p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Top countries</h2>
            {data.countries.length > 0 ? (
              data.countries.slice(0, 5).map((c) => (
                <BarRow key={c.code} label={c.code} count={c.count} max={maxCountry} />
              ))
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No data yet</p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Top referrers</h2>
            {data.referrers.length > 0 ? (
              data.referrers.slice(0, 5).map((r) => (
                <BarRow key={r.referrer} label={r.referrer} count={r.count} max={maxReferrer} />
              ))
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No data yet</p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Browsers &amp; OS</h2>
            {data.browsers.length > 0 ? (
              data.browsers.slice(0, 5).map((b) => (
                <BarRow key={b.name} label={b.name} count={b.count} max={maxBrowser} />
              ))
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No browser data yet</p>
            )}
            {data.operatingSystems.length > 0 &&
              data.operatingSystems.slice(0, 5).map((o) => (
                <BarRow key={o.name} label={o.name} count={o.count} max={maxOs} />
              ))}
          </div>
        </div>
      </div>
    </main>
  );
}
