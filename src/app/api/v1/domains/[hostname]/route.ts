import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Domain } from "@/models/Domain";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { removeDomain, VercelDomainsError } from "@/lib/vercel-domains";
import { detachLinksForHostname } from "@/lib/domain-state";
import { invalidateDomainStatus } from "@/lib/domain-cache";
import { hostnameSyntaxSchema } from "@/lib/validations";
import { verificationRecordName } from "@/lib/dns-verify";
import { vercelPointingRecord } from "@/lib/domains";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hostname: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`domains-read:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429, request);
  }

  try {
    const hostname = parseHostname(await params);
    if (!hostname) return apiError("Invalid hostname", 400, request);

    await connectDB();

    const domain = await Domain.findOne({ hostname, owner: session.user.id }).lean();
    if (!domain) {
      return apiError("Domain not found", 404, request);
    }

    return apiSuccess(
      {
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
        // The TXT record only proves ownership. This one is what makes the
        // hostname serve traffic, and both are needed before it goes live.
        pointingRecord:
          domain.status === "active" ? null : vercelPointingRecord(domain.hostname),
      },
      200,
      request
    );
  } catch (err) {
    captureError(err, { route: "api/v1/domains/[hostname]", method: "GET" });
    return apiError("Internal server error", 500, request);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ hostname: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`domains-delete:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429, request);
  }

  try {
    const hostname = parseHostname(await params);
    if (!hostname) return apiError("Invalid hostname", 400, request);

    const force = request.nextUrl.searchParams.get("force") === "true";

    await connectDB();

    const domain = await Domain.findOne({ hostname, owner: session.user.id });
    if (!domain) {
      return apiError("Domain not found", 404, request);
    }

    const linkCount = await Link.countDocuments({ domain: hostname, owner: session.user.id });

    if (linkCount > 0 && !force) {
      return apiError(
        `This domain still has ${linkCount} link${linkCount === 1 ? "" : "s"}. ` +
          "They will stop resolving if you remove it. Repeat with ?force=true to continue.",
        409,
        request
      );
    }

    // Detach at Vercel first. If that fails we leave the record in place, so a
    // retry is coherent rather than leaving an orphaned domain on the project.
    //
    // Only ever call Vercel for a domain this app actually attached, which is
    // exactly the domains that reached provisioning and so carry a
    // `vercelDomainId`. A `pending_dns` or `failed` record proves no ownership
    // whatsoever: without this guard, claiming an unrelated hostname that
    // happens to be attached to the same Vercel project and then deleting the
    // claim would detach it from the project and take that site offline.
    if (domain.vercelDomainId) {
      const removed = await removeDomain(hostname);
      if (!removed.ok) {
        captureError(new Error(`Vercel refused to remove domain: ${removed.code}`), {
          route: "api/v1/domains/[hostname]",
          method: "DELETE",
          vercelCode: removed.code,
        });
        return apiError("Could not detach the domain from the platform. Try again.", 502, request);
      }
    }

    await Domain.deleteOne({ _id: domain._id, owner: session.user.id });

    // The links themselves are kept, so the owner's history survives, but every
    // one of them is stamped as detached: a later claimant of this hostname must
    // not inherit rows that still resolve to this owner's destinations.
    const detachedLinks = await detachLinksForHostname(hostname);

    // Without this, the "servable" answer for the hostname stays cached for up
    // to 60s and the domain keeps resolving after it has been deleted.
    await invalidateDomainStatus(hostname);

    return apiSuccess(
      {
        deleted: hostname,
        orphanedLinks: linkCount,
        detachedLinks,
        message:
          linkCount > 0
            ? `${linkCount} link${linkCount === 1 ? " was" : "s were"} kept but will no longer resolve.`
            : "Domain removed.",
      },
      200,
      request
    );
  } catch (err) {
    if (err instanceof VercelDomainsError) {
      captureError(err, {
        route: "api/v1/domains/[hostname]",
        method: "DELETE",
        vercelCode: err.code,
      });
      return apiError("Domain management is temporarily unavailable", 503, request);
    }
    captureError(err, { route: "api/v1/domains/[hostname]", method: "DELETE" });
    return apiError("Internal server error", 500, request);
  }
}

/** Normalises and validates the hostname path segment. Returns null if invalid. */
function parseHostname(params: { hostname: string }): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(params.hostname);
  } catch {
    return null;
  }
  const parsed = hostnameSyntaxSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
