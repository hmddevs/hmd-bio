/**
 * Prose content for the API reference guides.
 *
 * The tier and custom-domain copy is carried over verbatim from the previous
 * /docs page: it is accurate against the live route handlers and was reviewed
 * when custom domains shipped. Restyle it freely, but do not reword the
 * technical claims without re-checking src/app/api/v1/**.
 */

export interface Tier {
  name: string;
  auth: string;
  rate: string;
  desc: string;
}

export const tiers: Tier[] = [
  {
    name: "Public",
    auth: "Turnstile token",
    rate: "30 req/min",
    desc: "Shorten, expand and view stats, no account needed.",
  },
  {
    name: "User",
    auth: "API key + Turnstile",
    rate: "100 req/min",
    desc: "Manage links, view analytics and control API keys.",
  },
];

export interface Step {
  title: string;
  body: string;
}

export const domainSteps: Step[] = [
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

export interface Snippet {
  label: string;
  code: string;
}

export const domainSnippets: Snippet[] = [
  {
    label: "Claim a hostname",
    code: `curl -X POST https://hmd.bio/api/v1/domains \\
  -H "Authorization: Bearer hmd_yourkey" \\
  -H "Content-Type: application/json" \\
  -d '{"hostname": "links.example.com"}'`,
  },
  {
    label: "Verify ownership and provision",
    code: `curl -X POST https://hmd.bio/api/v1/domains/links.example.com/verify \\
  -H "Authorization: Bearer hmd_yourkey"`,
  },
  {
    label: "Shorten a URL on a custom domain",
    code: `curl -X POST https://hmd.bio/api/v1/shorten \\
  -H "Authorization: Bearer hmd_yourkey" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/page", "domain": "links.example.com"}'`,
  },
  {
    label: "List links on a custom domain",
    code: `curl "https://hmd.bio/api/v1/links?domain=links.example.com" \\
  -H "Authorization: Bearer hmd_yourkey"`,
  },
  {
    label: "Get one link on a custom domain",
    code: `curl "https://hmd.bio/api/v1/links/mykeyword?domain=links.example.com" \\
  -H "Authorization: Bearer hmd_yourkey"`,
  },
];

export const gettingStartedSnippet = `curl -X POST https://hmd.bio/api/v1/shorten \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/some/long/path"}'`;

export const authSnippet = `curl https://hmd.bio/api/v1/links \\
  -H "Authorization: Bearer hmd_yourkey"`;

/** Sections that appear above the endpoint reference, in nav order. */
export const guideSections = [
  { id: "getting-started", label: "Getting started" },
  { id: "authentication", label: "Authentication" },
  { id: "rate-limits", label: "Rate limits" },
  { id: "custom-domains", label: "Custom domains" },
] as const;
