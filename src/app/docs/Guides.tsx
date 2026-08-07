import Link from "next/link";
import ApiKeyField from "./ApiKeyField";
import CopyButton from "./CopyButton";
import {
  authSnippet,
  domainSnippets,
  domainSteps,
  gettingStartedSnippet,
  tiers,
} from "./guide-content";

function Snippet({ label, code }: { label?: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-black/30">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {label ?? "Example"}
        </span>
        <CopyButton value={code} srLabel={`Copy the ${label ?? "example"} snippet`} />
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[11px] leading-relaxed text-gray-800 dark:text-gray-200">
        {code}
      </pre>
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={`${id}-heading`}
      className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white"
    >
      {children}
    </h2>
  );
}

/** The prose that sits above the endpoint reference. */
export default function Guides() {
  return (
    <div className="space-y-16">
      <section
        id="getting-started"
        aria-labelledby="getting-started-heading"
        className="scroll-mt-20"
      >
        <SectionHeading id="getting-started">Getting started</SectionHeading>
        <p className="mt-3 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
          The HMD.bio API is a plain JSON REST API over HTTPS. Every endpoint lives under{" "}
          <code className="font-mono text-[13px]">https://hmd.bio/api/v1</code>, every successful
          response is wrapped in{" "}
          <code className="font-mono text-[13px]">
            {"{ success, statusCode, data }"}
          </code>
          , and every failure in{" "}
          <code className="font-mono text-[13px]">{"{ success, statusCode, error }"}</code>. There
          is no SDK to install: anything that can send an HTTP request can use it.
        </p>
        <p className="mt-3 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
          Shortening a URL needs no account. This is the whole of the simplest useful call:
        </p>
        <div className="mt-4 max-w-2xl">
          <Snippet label="Shorten a URL" code={gettingStartedSnippet} />
        </div>
        <p className="mt-4 max-w-[70ch] text-sm text-gray-500 dark:text-gray-500">
          Public shortening is protected by Cloudflare Turnstile in production, so an unauthenticated
          call from a script needs a Turnstile token. Sending an API key instead skips Turnstile and
          attributes the link to your account.
        </p>
      </section>

      <section id="authentication" aria-labelledby="authentication-heading" className="scroll-mt-20">
        <SectionHeading id="authentication">Authentication</SectionHeading>
        <p className="mt-3 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
          Anything beyond the public endpoints needs a key. Create one under{" "}
          <Link
            href="/dashboard/settings"
            className="text-blue-600 underline underline-offset-2 dark:text-blue-400"
          >
            dashboard settings
          </Link>{" "}
          and send it as a bearer token. Keys look like{" "}
          <code className="font-mono text-[13px]">hmd_</code> followed by 64 hex characters, and the
          raw value is shown once at creation: only its hash is stored, so a lost key has to be
          replaced rather than recovered.
        </p>
        <div className="mt-4 max-w-2xl">
          <Snippet label="Authenticated request" code={authSnippet} />
        </div>
        <p className="mt-4 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
          The dashboard session cookie is accepted as an alternative on most endpoints. Two are
          session-only by design, managing API keys and changing the account email, since neither
          should be reachable with a key.
        </p>
        <div className="mt-5 max-w-2xl">
          <ApiKeyField />
        </div>
      </section>

      <section id="rate-limits" aria-labelledby="rate-limits-heading" className="scroll-mt-20">
        <SectionHeading id="rate-limits">Rate limits</SectionHeading>
        <p className="mt-3 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
          Limits are applied per tier. Public calls are counted per IP, authenticated calls per
          user, so a key raises your ceiling and stops you sharing a budget with everyone behind the
          same address. Exceeding a limit returns 429 with the standard error envelope; back off and
          retry rather than looping.
        </p>
        <dl className="mt-5 grid max-w-2xl gap-4 sm:grid-cols-2">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800"
            >
              <dt className="text-base font-semibold text-gray-900 dark:text-white">{tier.name}</dt>
              <dd className="mt-1 text-sm text-gray-600 dark:text-gray-400">{tier.desc}</dd>
              <dd className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-blue-600/10 px-2.5 py-0.5 font-medium text-blue-700 dark:bg-blue-400/10 dark:text-blue-300">
                  {tier.auth}
                </span>
                <span className="rounded-full bg-gray-500/10 px-2.5 py-0.5 font-medium text-gray-700 dark:text-gray-300">
                  {tier.rate}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-[70ch] text-sm text-gray-500 dark:text-gray-500">
          A handful of endpoints are stricter than their tier: unlocking a password-protected link,
          for instance, allows 5 attempts per minute. Where that applies it is noted on the endpoint.
        </p>
      </section>

      <section id="custom-domains" aria-labelledby="custom-domains-heading" className="scroll-mt-20">
        <SectionHeading id="custom-domains">Custom domains</SectionHeading>
        <p className="mt-3 max-w-[70ch] leading-relaxed text-gray-600 dark:text-gray-400">
          Attach your own hostname and create short links on it instead of hmd.bio. Requires a
          Bearer API key (User tier). Each account may attach up to{" "}
          <strong className="font-semibold text-gray-900 dark:text-white">3 domains</strong> by
          default. Links created through the public, unauthenticated shortener always use the primary
          domain (hmd.bio); only an authenticated caller with an active domain can target a custom
          hostname.
        </p>

        <ol className="mt-6 max-w-[70ch] space-y-5">
          {domainSteps.map((step) => (
            <li key={step.title}>
              <p className="font-semibold text-gray-900 dark:text-white">{step.title}</p>
              <p className="mt-1 leading-relaxed text-gray-600 dark:text-gray-400">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 grid max-w-4xl gap-4 md:grid-cols-2">
          {domainSnippets.map((snippet) => (
            <Snippet key={snippet.label} label={snippet.label} code={snippet.code} />
          ))}
        </div>
      </section>
    </div>
  );
}
