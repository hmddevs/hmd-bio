import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { editLinkSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireOwnership } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { isReservedKeyword } from "@/lib/utils";
import { domainFromQuery } from "@/lib/domain-access";
import { PRIMARY_DOMAIN, buildShortUrl } from "@/lib/domains";
import bcrypt from "bcryptjs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-keyword:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  const { keyword } = await params;
  const domain = domainFromQuery(request);
  if (!domain) return apiError("Invalid domain", 400);

  await connectDB();

  const link = await Link.findOne({ domain, keyword })
    .select("-password -ipRaw -ipIv")
    .lean();
  if (!link) {
    return apiError("Link not found", 404);
  }

  const forbidden = requireOwnership(link, session);
  if (forbidden) return forbidden;

  return apiSuccess({ ...link, shortUrl: buildShortUrl(link.domain, link.keyword) });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-keyword:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const { keyword } = await params;
    const body = await request.json();
    const parsed = editLinkSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    // `?domain=` wins when present; otherwise the body's `domain` selector is
    // used. Both default to the primary domain, so a client that sends neither
    // behaves exactly as before.
    const queryDomain = request.nextUrl.searchParams.get("domain") === null
      ? null
      : domainFromQuery(request);
    if (request.nextUrl.searchParams.get("domain") !== null && !queryDomain) {
      return apiError("Invalid domain", 400);
    }
    const domain = queryDomain ?? parsed.data.domain;

    await connectDB();

    const existing = await Link.findOne({ domain, keyword });
    if (!existing) {
      return apiError("Link not found", 404);
    }

    const forbidden = requireOwnership(existing, session);
    if (forbidden) return forbidden;

    const updates: Record<string, unknown> = {};

    if (parsed.data.url) updates.url = parsed.data.url;
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.statusCode) updates.statusCode = Number(parsed.data.statusCode);
    if (parsed.data.removePassword) {
      updates.isPasswordProtected = false;
      updates.password = null;
    } else {
      if (parsed.data.isPasswordProtected !== undefined) {
        updates.isPasswordProtected = parsed.data.isPasswordProtected;
      }
      if (parsed.data.password) {
        updates.password = await bcrypt.hash(parsed.data.password, 10);
        updates.isPasswordProtected = true;
      }
    }
    if (parsed.data.expiresAt !== undefined) {
      updates.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    }
    if (parsed.data.ogTitle !== undefined) updates.ogTitle = parsed.data.ogTitle;
    if (parsed.data.ogDescription !== undefined) updates.ogDescription = parsed.data.ogDescription;
    if (parsed.data.ogImage !== undefined) updates.ogImage = parsed.data.ogImage;
    // Absent means unchanged; an empty array clears every platform override and
    // sends the link back to resolving through `url` alone.
    if (parsed.data.targets !== undefined) updates.targets = parsed.data.targets;
    if (parsed.data.forwardPath !== undefined) updates.forwardPath = parsed.data.forwardPath;
    if (parsed.data.forwardQuery !== undefined) updates.forwardQuery = parsed.data.forwardQuery;

    // Handle keyword change
    if (parsed.data.keyword && parsed.data.keyword !== keyword) {
      const newKeyword = parsed.data.keyword;
      // Reserved keywords only shadow the platform's own routes, which exist on
      // the primary domain only.
      if (domain === PRIMARY_DOMAIN && isReservedKeyword(newKeyword)) {
        return apiError("This keyword is reserved", 400);
      }
      const conflict = await Link.findOne({ domain, keyword: newKeyword });
      if (conflict) {
        return apiError("New keyword already in use", 409);
      }
      updates.keyword = newKeyword;
      // Update click references, scoped to this domain so another tenant's
      // clicks on the same keyword are untouched.
      await Click.updateMany({ domain, keyword }, { keyword: newKeyword });
    }

    let updated;
    try {
      updated = await Link.findOneAndUpdate({ domain, keyword }, { $set: updates }, { new: true })
        .select("-password -ipRaw -ipIv")
        .lean();
    } catch (err) {
      // A concurrent create can win the (domain, keyword) index between the
      // conflict check and the rename.
      if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
        return apiError("New keyword already in use", 409);
      }
      throw err;
    }

    if (!updated) {
      return apiError("Link not found", 404);
    }

    return apiSuccess({ ...updated, shortUrl: buildShortUrl(updated.domain, updated.keyword) });
  } catch (err) {
    captureError(err, { route: "links/[keyword]", method: "PUT" });
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-keyword:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  const { keyword } = await params;
  const domain = domainFromQuery(request);
  if (!domain) return apiError("Invalid domain", 400);

  await connectDB();

  const existing = await Link.findOne({ domain, keyword });
  if (!existing) {
    return apiError("Link not found", 404);
  }

  const forbidden = requireOwnership(existing, session);
  if (forbidden) return forbidden;

  const ownerId = existing.owner ? existing.owner.toString() : null;

  await Link.deleteOne({ domain, keyword });

  // Also remove click logs, scoped to the same domain.
  const removedClicks = await Click.deleteMany({ domain, keyword });

  // Not an /admin route, but `requireOwnership` lets an administrator through
  // on somebody else's link, so this is the one destructive administrative
  // action that does not live under /api/v1/admin. Deleting the link destroys
  // its clicks too, which is the very data the audit trail exists to account
  // for. A user deleting their own link is ordinary self-service and is not
  // recorded.
  if (session.user.role === "admin" && ownerId !== session.user.id) {
    await recordAudit({
      request,
      actor: session.user,
      action: "admin.link.delete",
      subjectType: "link",
      subjectIds: [`${domain} ${keyword}`],
      route: "links/[keyword]:DELETE",
      detail: {
        domain,
        keyword,
        owner: ownerId,
        clicksDeleted: removedClicks.deletedCount ?? 0,
      },
    });
  }

  return apiSuccess({ deleted: keyword, domain });
}
