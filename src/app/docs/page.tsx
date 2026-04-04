"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

const tiers = [
  {
    name: "Public",
    auth: "Turnstile token",
    rate: "30 req/min",
    desc: "Shorten, expand & view stats — no account needed.",
  },
  {
    name: "User",
    auth: "API key + Turnstile",
    rate: "100 req/min",
    desc: "Manage links, view analytics & control API keys.",
  },
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-gray-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          {tiers.map((t) => (
            <div
              key={t.name}
              className="rounded-xl border border-gray-800 bg-gray-900 p-5"
            >
              <h3 className="text-lg font-semibold text-white">{t.name}</h3>
              <p className="mt-1 text-sm text-gray-400">{t.desc}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-blue-900/40 px-2.5 py-0.5 text-blue-300">
                  {t.auth}
                </span>
                <span className="rounded-full bg-emerald-900/40 px-2.5 py-0.5 text-emerald-300">
                  {t.rate}
                </span>
              </div>
            </div>
          ))}
        </div>

        <SwaggerUI url="/api/docs" />
      </div>
    </main>
  );
}
