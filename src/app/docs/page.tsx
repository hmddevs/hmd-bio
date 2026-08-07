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

const domainSteps = [
  {
    title: "1. Claim the hostname",
    body: "POST /api/v1/domains with the bare hostname you own. The response carries both records you need: dnsRecord (ownership) and pointingRecord (traffic). Two DNS records are always required, and the domain does not go live until both exist.",
  },
  {
    title: "2. Add the TXT record",
    body: "Create a TXT record at _hmd-verify.<yourdomain> with the value from dnsRecord, at your DNS provider. It proves ownership and nothing more.",
  },
  {
    title: "3. Add the pointing record",
    body: "Create the record from pointingRecord. For an apex domain such as example.com or guden.com.tr that is an A record on the domain itself, written as \"@\" at most providers. For a subdomain such as links.example.com it is a CNAME on the subdomain label. Never use a CNAME at an apex: it is invalid DNS and breaks the domain's other records. If your DNS runs behind a proxy such as Cloudflare, set this record to \"DNS only\" (grey cloud), because a proxied record hides the domain from us.",
  },
  {
    title: "4. Verify",
    body: "POST /api/v1/domains/{hostname}/verify. This checks the TXT record, then attaches the domain. A 202 means ownership is confirmed but DNS is not pointing at us yet: check the record from step 3 and call verify again once DNS has propagated.",
  },
  {
    title: "5. Create links on it",
    body: "Once status is active, pass \"domain\": \"yourdomain.com\" to /api/v1/shorten, or ?domain=yourdomain.com to /api/v1/links.",
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

        <div className="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-lg font-semibold text-white">Custom domains</h3>
          <p className="mt-1 text-sm text-gray-400">
            Attach your own hostname and create short links on it instead of hmd.bio.
            Requires a Bearer API key (User tier). Each account may attach up to{" "}
            <span className="text-gray-200">3 domains</span> by default. Links created
            through the public, unauthenticated shortener always use the primary domain
            (hmd.bio); only an authenticated caller with an active domain can target a
            custom hostname.
          </p>

          <ol className="mt-4 space-y-3">
            {domainSteps.map((step) => (
              <li key={step.title} className="text-sm">
                <span className="font-medium text-gray-200">{step.title}</span>
                <p className="mt-0.5 text-gray-400">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-5 space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-400">Claim a hostname</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-black/60 p-3 text-xs text-gray-200">
{`curl -X POST https://hmd.bio/api/v1/domains \\
  -H "Authorization: Bearer hmd_yourkey" \\
  -H "Content-Type: application/json" \\
  -d '{"hostname": "links.example.com"}'`}
              </pre>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-400">Verify ownership and provision</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-black/60 p-3 text-xs text-gray-200">
{`curl -X POST https://hmd.bio/api/v1/domains/links.example.com/verify \\
  -H "Authorization: Bearer hmd_yourkey"`}
              </pre>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-400">Shorten a URL on a custom domain</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-black/60 p-3 text-xs text-gray-200">
{`curl -X POST https://hmd.bio/api/v1/shorten \\
  -H "Authorization: Bearer hmd_yourkey" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/page", "domain": "links.example.com"}'`}
              </pre>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-400">List links on a custom domain</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-black/60 p-3 text-xs text-gray-200">
{`curl "https://hmd.bio/api/v1/links?domain=links.example.com" \\
  -H "Authorization: Bearer hmd_yourkey"`}
              </pre>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-400">Get one link on a custom domain</p>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-black/60 p-3 text-xs text-gray-200">
{`curl "https://hmd.bio/api/v1/links/mykeyword?domain=links.example.com" \\
  -H "Authorization: Bearer hmd_yourkey"`}
              </pre>
            </div>
          </div>
        </div>

        <SwaggerUI url="/api/docs" />
      </div>
    </main>
  );
}
