import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Domain } from "@/models/Domain";
import { domainSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { generateVerificationToken, detachLinksForHostname } from "@/lib/domain-state";
import { invalidateDomainStatus } from "@/lib/domain-cache";
import { verificationRecordName } from "@/lib/dns-verify";
import { vercelPointingRecord } from "@/lib/domains";
import type { IDomain } from "@/models/Domain";

/**
 * How long an unverified claim may block a hostname for everybody else.
 */
const STALE_CLAIM_MS = 48 * 60 * 60 * 1000;

/**
 * True when an existing record is an abandoned claim that another user may take
 * over.
 *
 * Only `pending_dns` and `failed` qualify: those are claims where the holder has
 * never proved ownership. `verifying`, `provisioning`, `active` and `suspended`
 * are never takeoverable, so a domain cannot be stolen from someone who has
 * proved ownership or is in the middle of doing so.
 *
 * Staleness is measured from `updatedAt`, not `createdAt`, so any activity on
 * the record (asking us to check DNS, a failed verification) resets the clock.
 * That is what stops the window being used against a real owner who is working
 * through their registrar's DNS propagation.
 *
 * The owner's own record is never stale to them: they get the usual 409 and
 * keep their existing token rather than silently losing it.
 */
function isStaleClaim(existing: IDomain, requesterId: string): boolean {
  if (existing.owner.toString() === requesterId) return false;
  if (existing.status !== "pending_dns" && existing.status !== "failed") return false;
  const lastActivity = existing.updatedAt ?? existing.createdAt;
  return Date.now() - new Date(lastActivity).getTime() > STALE_CLAIM_MS;
}

/** Per-user cap on attached domains. */
function maxDomainsPerUser(): number {
  const parsed = Number.parseInt(process.env.MAX_DOMAINS_PER_USER ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

interface DomainDocumentShape {
  hostname: string;
  status: string;
  verificationToken: string;
  verifiedAt?: Date | null;
  failureReason?: string | null;
  linkCount: number;
  createdAt: Date;
}

/**
 * Shapes a domain for the owner who requested it. The verification token is
 * included only while the domain is not yet active, because that is the only
 * time it is useful, and it is only ever reached through an owner-scoped
 * query.
 */
function presentForOwner(domain: DomainDocumentShape) {
  return {
    hostname: domain.hostname,
    status: domain.status,
    verifiedAt: domain.verifiedAt ?? null,
    linkCount: domain.linkCount,
    failureReason: domain.failureReason ?? null,
    createdAt: domain.createdAt,
    dnsRecord:
      domain.status === "active"
        ? null
        : {
            recordType: "TXT" as const,
            name: verificationRecordName(domain.hostname),
            value: domain.verificationToken,
          },
    // Attaching a domain needs two DNS records, not one: the TXT above proves
    // ownership, this one makes the hostname actually serve traffic.
    pointingRecord:
      domain.status === "active" ? null : vercelPointingRecord(domain.hostname),
  };
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`domains-list:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429, request);
  }

  try {
    await connectDB();

    // Always scoped by owner, with no admin bypass: this listing returns
    // verification tokens, which belong to the owner alone.
    const domains = await Domain.find({ owner: session.user.id })
      .sort({ createdAt: -1 })
      .lean();

    return apiSuccess(
      {
        domains: domains.map((d) => presentForOwner(d as unknown as DomainDocumentShape)),
        limit: maxDomainsPerUser(),
      },
      200,
      request
    );
  } catch (err) {
    captureError(err, { route: "api/v1/domains", method: "GET" });
    return apiError("Internal server error", 500, request);
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`domains-create:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429, request);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("Request body must be valid JSON", 400, request);
    }

    const parsed = domainSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400, request);
    }
    const { hostname } = parsed.data;

    await connectDB();

    const limit = maxDomainsPerUser();
    const owned = await Domain.countDocuments({ owner: session.user.id });
    if (owned >= limit) {
      return apiError(`You can attach at most ${limit} domains`, 403, request);
    }

    // Convenience pre-check. The unique index below is the real guard, so the
    // duplicate-key path is handled too rather than trusted away.
    const existing = await Domain.findOne({ hostname });
    if (existing) {
      if (!isStaleClaim(existing, session.user.id)) {
        return apiError("This domain is already claimed", 409, request);
      }
      // Stale unverified claim by someone else: release it so the real owner is
      // not locked out. Its links are stamped as detached first, so the new
      // claimant can never inherit them.
      await detachLinksForHostname(hostname);
      await Domain.deleteOne({ _id: existing._id, status: existing.status });
      await invalidateDomainStatus(hostname);
    }

    const verificationToken = generateVerificationToken();

    let created;
    try {
      created = await Domain.create({
        hostname,
        owner: session.user.id,
        status: "pending_dns",
        verificationToken,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return apiError("This domain is already claimed", 409, request);
      }
      throw err;
    }

    return apiSuccess(
      {
        hostname: created.hostname,
        status: created.status,
        linkCount: created.linkCount,
        createdAt: created.createdAt,
        dnsRecord: {
          recordType: "TXT" as const,
          name: verificationRecordName(created.hostname),
          value: created.verificationToken,
        },
        pointingRecord: vercelPointingRecord(created.hostname),
        nextStep:
          "Create both records at your DNS provider, then call POST /api/v1/domains/{hostname}/verify. " +
          "The TXT record proves ownership; the second record points the domain at us. " +
          "If your DNS is behind a proxy such as Cloudflare, set the pointing record to DNS only.",
      },
      201,
      request
    );
  } catch (err) {
    captureError(err, { route: "api/v1/domains", method: "POST" });
    return apiError("Internal server error", 500, request);
  }
}
