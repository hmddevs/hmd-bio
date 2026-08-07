/**
 * Minimal Vercel REST client for attaching and detaching custom domains on
 * this project.
 *
 * Server-only. Never import this from a client component: it reads
 * VERCEL_API_TOKEN, which must never reach a browser bundle.
 *
 * Two failure shapes are deliberately distinguished:
 *
 *   - Expected API outcomes (domain already owned elsewhere, forbidden, not
 *     found, misconfigured) come back as `{ ok: false, code, message }`, so a
 *     route can turn them into a 4xx without a try/catch.
 *   - Genuine faults (missing configuration, network failure, timeout, an
 *     unparseable response) throw `VercelDomainsError`, which the route
 *     reports to Sentry and turns into a 5xx.
 *
 * The API token is read from the environment on every call and is never
 * logged, never placed in a thrown message, and never attached to a Sentry
 * context object.
 */

import { captureError } from "@/lib/errors";
import { vercelPointingRecord } from "@/lib/domains";

const VERCEL_API_BASE = "https://api.vercel.com";
const REQUEST_TIMEOUT_MS = 10_000;

/** Error codes this module raises for genuine faults. */
export type VercelFaultCode =
  | "not_configured"
  | "network_error"
  | "timeout"
  | "bad_response"
  | "unexpected_status";

export class VercelDomainsError extends Error {
  readonly code: VercelFaultCode;
  /** True when a retry of the same call could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: VercelFaultCode, message: string, retryable: boolean) {
    super(message);
    this.name = "VercelDomainsError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Expected, caller-handleable API outcomes. */
export type VercelFailureCode =
  | "domain_already_in_use"
  | "forbidden"
  | "not_found"
  | "invalid_domain"
  | "rate_limited"
  | "api_error";

export type VercelResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: VercelFailureCode; message: string };

export interface VercelDomainRecord {
  /** Vercel's own identifier for the project-domain association. */
  id: string | null;
  name: string;
  verified: boolean;
}

export interface VercelDomainStatus {
  /** Vercel considers the domain verified against the project. */
  verified: boolean;
  /** DNS is not yet pointing at Vercel, so the domain will not serve traffic. */
  misconfigured: boolean;
  /** Human-readable explanation of a misconfiguration, when Vercel gives one. */
  error?: string;
  /** Records Vercel wants the user to create, when it reports a misconfiguration. */
  requiredRecords?: Array<{ type: string; name: string; value: string }>;
}

interface VercelConfig {
  token: string;
  projectId: string;
  teamId: string | null;
}

/**
 * Reads configuration from the environment. Throws rather than returning a
 * disabled client, so a misconfigured deployment fails loudly on first use
 * instead of silently accepting domains it will never provision.
 */
function readConfig(): VercelConfig {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();

  if (!token || !projectId) {
    // Names only. The value of VERCEL_API_TOKEN never appears in a message.
    const missing = [!token && "VERCEL_API_TOKEN", !projectId && "VERCEL_PROJECT_ID"]
      .filter(Boolean)
      .join(", ");
    throw new VercelDomainsError(
      "not_configured",
      `Vercel domain management is not configured: missing ${missing}`,
      false
    );
  }

  return { token, projectId, teamId: teamId || null };
}

/** Appends `?teamId=` when the project lives under a team. */
function withTeam(path: string, config: VercelConfig): string {
  if (!config.teamId) return `${VERCEL_API_BASE}${path}`;
  const separator = path.includes("?") ? "&" : "?";
  return `${VERCEL_API_BASE}${path}${separator}teamId=${encodeURIComponent(config.teamId)}`;
}

interface VercelErrorBody {
  error?: { code?: string; message?: string };
}

interface RawResponse {
  status: number;
  body: unknown;
}

/**
 * Performs one authenticated request. Throws VercelDomainsError for transport
 * faults; returns the raw status and parsed body otherwise, leaving status
 * interpretation to the caller.
 */
async function request(
  method: "GET" | "POST" | "DELETE",
  path: string,
  config: VercelConfig,
  payload?: unknown
): Promise<RawResponse> {
  let response: Response;

  try {
    response = await fetch(withTeam(path, config), {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    // A timeout aborts the fetch. It is a failure, never an implicit success:
    // the caller must not assume the domain was added.
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new VercelDomainsError(
      timedOut ? "timeout" : "network_error",
      timedOut
        ? `Vercel API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : "Vercel API request failed at the network layer",
      true
    );
  }

  // A 204 or an empty body is legitimate on DELETE.
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new VercelDomainsError(
        "bad_response",
        `Vercel API returned a non-JSON body with status ${response.status}`,
        true
      );
    }
  }

  return { status: response.status, body };
}

function errorFrom(raw: RawResponse): { code: string; message: string } {
  const body = raw.body as VercelErrorBody | null;
  return {
    code: body?.error?.code ?? "unknown",
    message: body?.error?.message ?? `Vercel API responded with status ${raw.status}`,
  };
}

/**
 * Maps a non-2xx response onto an expected failure where we recognise it, or
 * throws for anything genuinely unexpected (5xx, unknown 4xx).
 */
function toFailure(raw: RawResponse, operation: string): VercelResult<never> {
  const { code, message } = errorFrom(raw);

  switch (code) {
    case "domain_already_in_use":
    case "domain_taken":
    case "domain_already_in_use_by_another_project":
      return {
        ok: false,
        code: "domain_already_in_use",
        message: "This domain is already attached to another Vercel project.",
      };
    case "forbidden":
      return {
        ok: false,
        code: "forbidden",
        message: "Vercel refused the request for this domain.",
      };
    case "not_found":
    case "domain_not_found":
      return { ok: false, code: "not_found", message: "Domain not found on this project." };
    case "invalid_domain":
      return { ok: false, code: "invalid_domain", message: "Vercel rejected this hostname." };
    default:
      break;
  }

  if (raw.status === 403) {
    return { ok: false, code: "forbidden", message: "Vercel refused the request for this domain." };
  }
  if (raw.status === 404) {
    return { ok: false, code: "not_found", message: "Domain not found on this project." };
  }
  if (raw.status === 409) {
    return {
      ok: false,
      code: "domain_already_in_use",
      message: "This domain is already attached to another Vercel project.",
    };
  }
  if (raw.status === 429) {
    return { ok: false, code: "rate_limited", message: "Vercel API rate limit reached." };
  }
  if (raw.status >= 400 && raw.status < 500) {
    return { ok: false, code: "api_error", message };
  }

  // 5xx and anything else is a fault on their side, worth a Sentry event.
  const fault = new VercelDomainsError(
    "unexpected_status",
    `Vercel ${operation} failed with status ${raw.status} (${code})`,
    true
  );
  captureError(fault, { module: "vercel-domains", operation, status: raw.status, vercelCode: code });
  throw fault;
}

/**
 * Attaches a hostname to the project. Vercel returns the existing record when
 * the domain is already attached to this same project, which we treat as
 * success so that verify stays idempotent.
 */
export async function addDomain(hostname: string): Promise<VercelResult<VercelDomainRecord>> {
  const config = readConfig();
  const raw = await request(
    "POST",
    `/v10/projects/${encodeURIComponent(config.projectId)}/domains`,
    config,
    { name: hostname }
  );

  if (raw.status < 200 || raw.status >= 300) {
    return toFailure(raw, "addDomain");
  }

  // The project-domains endpoint identifies a domain by its name, not by a uid
  // (that field belongs to account-level domains), so `uid` is normally absent
  // here. Fall back to the hostname, which is what removeDomain keys on anyway.
  // The value doubles as the marker that we were the ones who attached this
  // domain, so it must never come back null on a successful add.
  const body = raw.body as { uid?: string; id?: string; name?: string; verified?: boolean } | null;
  return {
    ok: true,
    data: {
      id: body?.uid ?? body?.id ?? body?.name ?? hostname,
      name: body?.name ?? hostname,
      verified: body?.verified === true,
    },
  };
}

/**
 * Detaches a hostname from the project. A domain that is already absent is
 * reported as success, so a repeated delete is safe.
 */
export async function removeDomain(hostname: string): Promise<VercelResult<{ removed: boolean }>> {
  const config = readConfig();
  const raw = await request(
    "DELETE",
    `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(hostname)}`,
    config
  );

  if (raw.status >= 200 && raw.status < 300) {
    return { ok: true, data: { removed: true } };
  }

  const failure = toFailure(raw, "removeDomain");
  if (!failure.ok && failure.code === "not_found") {
    return { ok: true, data: { removed: false } };
  }
  return failure;
}

/**
 * Vercel returns recommended records in more than one shape depending on the
 * record type and API version: a bare string, or a ranked entry whose `value`
 * is itself a string or an array of strings. Both are normalised to a single
 * string before they leave this module, because a caller that trusts one shape
 * ends up putting an object where a hostname belongs.
 */
type RecommendedRecord = string | { rank?: number; value?: string | string[] };

interface DomainConfigBody {
  misconfigured?: boolean;
  recommendedCNAME?: RecommendedRecord[];
  recommendedIPv4?: RecommendedRecord[];
}

function firstRecordValue(records: RecommendedRecord[] | undefined): string | null {
  const entry = records?.[0];
  if (!entry) return null;

  if (typeof entry === "string") return entry.trim() || null;

  const value = entry.value;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim());
    return first ? first.trim() : null;
  }
  return null;
}

/**
 * Reads the project-domain record plus its DNS configuration, and normalises
 * the pair into the two booleans a route actually needs.
 */
export async function getDomainStatus(
  hostname: string
): Promise<VercelResult<VercelDomainStatus>> {
  const config = readConfig();
  const encodedProject = encodeURIComponent(config.projectId);
  const encodedHost = encodeURIComponent(hostname);

  const domainRaw = await request(
    "GET",
    `/v9/projects/${encodedProject}/domains/${encodedHost}`,
    config
  );
  if (domainRaw.status < 200 || domainRaw.status >= 300) {
    return toFailure(domainRaw, "getDomainStatus");
  }

  const domainBody = domainRaw.body as { verified?: boolean } | null;
  const verified = domainBody?.verified === true;

  const configRaw = await request("GET", `/v6/domains/${encodedHost}/config`, config);
  if (configRaw.status < 200 || configRaw.status >= 300) {
    return toFailure(configRaw, "getDomainStatus.config");
  }

  const configBody = configRaw.body as DomainConfigBody | null;
  const misconfigured = configBody?.misconfigured === true;

  const requiredRecords: Array<{ type: string; name: string; value: string }> = [];
  if (misconfigured) {
    const cname = firstRecordValue(configBody?.recommendedCNAME);
    if (cname) {
      requiredRecords.push({ type: "CNAME", name: hostname, value: cname });
    }
    const ipv4 = firstRecordValue(configBody?.recommendedIPv4);
    if (ipv4) {
      requiredRecords.push({ type: "A", name: hostname, value: ipv4 });
    }

    // The config endpoint does not always return recommendations, and an empty
    // list while misconfigured leaves the user with an instruction and no
    // record to follow it with. Fall back to the record we know is correct for
    // this hostname. Vercel's own values win whenever it gives us any.
    if (requiredRecords.length === 0) {
      const fallback = vercelPointingRecord(hostname);
      requiredRecords.push({
        type: fallback.recordType,
        name: fallback.name,
        value: fallback.value,
      });
    }
  }

  return {
    ok: true,
    data: {
      verified,
      misconfigured,
      ...(misconfigured
        ? { error: "DNS for this domain does not yet point at Vercel." }
        : {}),
      ...(requiredRecords.length > 0 ? { requiredRecords } : {}),
    },
  };
}
