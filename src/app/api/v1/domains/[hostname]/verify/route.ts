import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Domain, type IDomain } from "@/models/Domain";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { transition } from "@/lib/domain-state";
import { verifyDomainTxt, verificationRecordName } from "@/lib/dns-verify";
import { addDomain, getDomainStatus, VercelDomainsError } from "@/lib/vercel-domains";
import { hostnameSyntaxSchema } from "@/lib/validations";

/**
 * Certificate issuance is not instant, so the request polls Vercel a small,
 * fixed number of times and then hands back. It never loops until success:
 * an unfinished domain stays in `provisioning` and the client calls verify
 * again.
 */
const STATUS_POLL_ATTEMPTS = 3;
const STATUS_POLL_DELAY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Response shape shared by every successful outcome of this route. */
function present(domain: IDomain, extra: Record<string, unknown> = {}) {
  return {
    hostname: domain.hostname,
    status: domain.status,
    verifiedAt: domain.verifiedAt ?? null,
    failureReason: domain.failureReason ?? null,
    ...extra,
  };
}

/**
 * Polls Vercel until the domain reports verified, or the attempt budget runs
 * out. Returns the last status seen.
 */
async function pollVercel(hostname: string) {
  let last = await getDomainStatus(hostname);
  for (let attempt = 1; attempt < STATUS_POLL_ATTEMPTS; attempt++) {
    if (!last.ok || (last.data.verified && !last.data.misconfigured)) break;
    await sleep(STATUS_POLL_DELAY_MS);
    last = await getDomainStatus(hostname);
  }
  return last;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hostname: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  // Six an hour: enough for a user fixing DNS, too few to walk someone else's
  // zone looking for records.
  const rl = await rateLimit(`domains-verify:${session.user.id}`, {
    limit: 6,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) {
    return apiError("Too many verification attempts. Try again later.", 429, request);
  }

  try {
    const { hostname: rawHostname } = await params;
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawHostname);
    } catch {
      return apiError("Invalid hostname", 400, request);
    }
    const parsed = hostnameSyntaxSchema.safeParse(decoded);
    if (!parsed.success) {
      return apiError("Invalid hostname", 400, request);
    }
    const hostname = parsed.data;

    await connectDB();

    // Ownership comes from the query, not the path. A caller who knows
    // someone else's hostname gets the same 404 as one who invented it.
    const domain = await Domain.findOne({ hostname, owner: session.user.id });
    if (!domain) {
      return apiError("Domain not found", 404, request);
    }

    if (domain.status === "suspended") {
      return apiError("This domain is suspended. Contact support.", 403, request);
    }

    // Idempotent: verifying an active domain changes nothing.
    if (domain.status === "active") {
      return apiSuccess(present(domain, { message: "Domain is already active" }), 200, request);
    }

    // Already handed to Vercel: skip the TXT check and just read the cert and
    // DNS state. `provisioning` may only move to `active` or `failed`.
    if (domain.status === "provisioning") {
      return await finishProvisioning(domain, request);
    }

    await transition(domain, "verifying", { lastCheckedAt: new Date() });

    const dns = await verifyDomainTxt(hostname, domain.verificationToken);
    if (!dns.matched) {
      const reason = dns.found
        ? "A TXT record exists at the verification name but does not match the expected token."
        : "No TXT record was found at the verification name.";
      await transition(domain, "failed", { failureReason: reason, lastCheckedAt: new Date() });

      return apiError(reason, 400, request);
    }

    const added = await addDomain(hostname);
    if (!added.ok) {
      await transition(domain, "failed", {
        failureReason: added.message,
        lastCheckedAt: new Date(),
      });
      const status = added.code === "domain_already_in_use" ? 409 : 400;
      return apiError(added.message, status, request);
    }

    await transition(domain, "provisioning", {
      vercelDomainId: added.data.id,
      failureReason: null,
      lastCheckedAt: new Date(),
    });

    return await finishProvisioning(domain, request);
  } catch (err) {
    if (err instanceof VercelDomainsError) {
      captureError(err, {
        route: "api/v1/domains/[hostname]/verify",
        vercelCode: err.code,
        retryable: err.retryable,
      });
      return apiError("Domain provisioning is temporarily unavailable", 503, request);
    }
    captureError(err, { route: "api/v1/domains/[hostname]/verify", method: "POST" });
    return apiError("Internal server error", 500, request);
  }
}

/**
 * Reads Vercel's view of an already-attached domain and settles the record:
 * active when the domain is verified and configured, otherwise left in
 * `provisioning` with the DNS the user still has to create.
 */
async function finishProvisioning(domain: IDomain, request: NextRequest) {
  const status = await pollVercel(domain.hostname);

  if (!status.ok) {
    await transition(domain, "failed", {
      failureReason: status.message,
      lastCheckedAt: new Date(),
    });
    return apiError(status.message, 400, request);
  }

  if (status.data.verified && !status.data.misconfigured) {
    await transition(domain, "active", {
      verifiedAt: new Date(),
      failureReason: null,
      lastCheckedAt: new Date(),
    });
    return apiSuccess(present(domain, { message: "Domain is active" }), 200, request);
  }

  // Ownership is proven, but traffic will not reach us until the user points
  // DNS at Vercel. Stay in provisioning and say exactly what is missing.
  domain.lastCheckedAt = new Date();
  domain.failureReason = status.data.error ?? null;
  await domain.save();

  return apiSuccess(
    present(domain, {
      message: "Ownership verified. Finish DNS setup to bring the domain online.",
      dnsRecord: {
        recordType: "TXT" as const,
        name: verificationRecordName(domain.hostname),
        value: domain.verificationToken,
      },
      requiredRecords: status.data.requiredRecords ?? [],
    }),
    202,
    request
  );
}
