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
import { invalidateDomainConfig } from "@/lib/domain-config-cache";
import { deeplinkConfigSchema, hostnameSyntaxSchema } from "@/lib/validations";
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
        // The deeplink fields below (mode, appLinks, fallbackTarget) are
        // identical to the ones PATCH returns; the rest of this response is a
        // superset PATCH does not carry. Falling back to "shortener" matters
        // for documents created before deeplink mode existed: without it the
        // config dialog would
        // read `undefined`, and saving would silently switch a configured
        // deeplink domain back to shortener mode.
        mode: domain.mode ?? "shortener",
        appLinks: {
          aasa: domain.appLinks?.aasa ?? null,
          assetlinks: domain.appLinks?.assetlinks ?? null,
        },
        fallbackTarget: domain.fallbackTarget ?? null,
        pathPrefix: domain.pathPrefix ?? null,
        // Association files can be up to 128KB each, so this response can grow
        // large. Acceptable here: owner-scoped, not a hot path, and Apple's CDN
        // cache invariant means these strings must never be reserialised.
        updatedAt: domain.updatedAt,
      },
      200,
      request
    );
  } catch (err) {
    captureError(err, { route: "api/v1/domains/[hostname]", method: "GET" });
    return apiError("Internal server error", 500, request);
  }
}

/**
 * Ceiling on the PATCH body, checked before anything is buffered.
 *
 * The largest legitimate body is both association files at their 128 KB cap.
 * Each is carried as a JSON string inside JSON, and escaping can in the worst
 * case double it (a document of nothing but quotes and backslashes), so
 * 2 x 128 KB x 2 = 512 KB is the real upper bound; 768 KB leaves headroom for
 * the keys, the fallback target and any whitespace without being generous
 * enough to be worth abusing.
 */
const MAX_PATCH_BODY_BYTES = 768 * 1024;

/**
 * Updates a domain's deeplink configuration: mode, the two association files,
 * the fallback target, and the path prefix. Partial by design, so a client may
 * send one field.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ hostname: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`domains-write:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429, request);
  }

  try {
    const hostname = parseHostname(await params);
    if (!hostname) return apiError("Invalid hostname", 400, request);

    // Defence in depth only: content-length may be absent or a lie, so the Zod
    // byte caps below remain the authoritative limit. This just stops an
    // honestly-declared oversized body being buffered into memory first.
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PATCH_BODY_BYTES) {
      return apiError("Request body is too large", 400, request);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("Invalid JSON body", 400, request);
    }

    const parsed = deeplinkConfigSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400, request);
    }

    await connectDB();

    // Scoped to the owner, so another user's domain is a 404 rather than a 403:
    // the endpoint must not confirm that a hostname is claimed at all.
    const domain = await Domain.findOne({ hostname, owner: session.user.id });
    if (!domain) {
      return apiError("Domain not found", 404, request);
    }

    // Deliberate: deeplink mode may be set on a domain that is not yet active.
    // A customer configures the association files while DNS verification is
    // still in flight, and nothing is served until `status` reaches "active"
    // anyway, because `getDomainConfig` filters on it.
    const updates: Record<string, unknown> = {};

    if (parsed.data.mode !== undefined) updates.mode = parsed.data.mode;
    // Dotted paths, so sending only one association file leaves the other in
    // place. Assigning the whole `appLinks` object would silently null the one
    // the client did not mention.
    if (parsed.data.appLinks?.aasa !== undefined) {
      updates["appLinks.aasa"] = parsed.data.appLinks.aasa;
    }
    if (parsed.data.appLinks?.assetlinks !== undefined) {
      updates["appLinks.assetlinks"] = parsed.data.appLinks.assetlinks;
    }
    if (parsed.data.fallbackTarget !== undefined) {
      updates.fallbackTarget = parsed.data.fallbackTarget;
    }
    if (parsed.data.pathPrefix !== undefined) {
      updates.pathPrefix = parsed.data.pathPrefix;
    }

    const updated =
      Object.keys(updates).length > 0
        ? await Domain.findOneAndUpdate(
            { _id: domain._id, owner: session.user.id },
            { $set: updates },
            { new: true }
          ).lean()
        : domain.toObject();

    if (!updated) {
      return apiError("Domain not found", 404, request);
    }

    // Mandatory, not an optimisation. These edits leave `status` untouched, so
    // `invalidateDomainStatus` never fires and nothing else clears the config
    // key: without this the proxy serves the previous mode, association files,
    // and fallback target for up to 60s. Best-effort by contract, since Redis
    // is optional and a cache failure must not undo a committed write.
    await invalidateDomainConfig(hostname);

    return apiSuccess(
      {
        hostname: updated.hostname,
        status: updated.status,
        mode: updated.mode,
        appLinks: {
          aasa: updated.appLinks?.aasa ?? null,
          assetlinks: updated.appLinks?.assetlinks ?? null,
        },
        fallbackTarget: updated.fallbackTarget ?? null,
        pathPrefix: updated.pathPrefix ?? null,
        updatedAt: updated.updatedAt,
      },
      200,
      request
    );
  } catch (err) {
    captureError(err, { route: "api/v1/domains/[hostname]", method: "PATCH" });
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
