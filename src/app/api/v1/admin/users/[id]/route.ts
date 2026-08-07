import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Link } from "@/models/Link";
import { Domain } from "@/models/Domain";
import { detachLinksForHostname } from "@/lib/domain-state";
import { invalidateDomainStatus } from "@/lib/domain-cache";
import { removeDomain, VercelDomainsError } from "@/lib/vercel-domains";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitCaller } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { sendApprovalEmail } from "@/lib/email";
import { adminEditProfileSchema } from "@/lib/validations";
import { recordAudit, type AuditAction } from "@/lib/audit";
import mongoose from "mongoose";

// Deleting a user detaches each of their domains from Vercel one at a time,
// and each call allows itself 10 seconds. A user holding several provisioned
// domains against a slow Vercel API would otherwise exhaust the default
// function budget and die mid-loop, which surfaces as a platform 504 rather
// than the 502 this route raises deliberately. Local state is untouched either
// way and a retry is idempotent, so this buys diagnosability, not correctness.
export const maxDuration = 60;

// Every administrative change to somebody else's account is recorded, not only
// deletion. Disabling hides an account from its owner and promoting hands out
// administrative access, which is exactly what an investigation into a
// compromised admin account needs to be able to see.
//
// This map is the single list of administrative actions: the accepted set and
// the error message are both derived from it below. Two hand-maintained lists
// would agree until somebody added an action to one of them, and the failure
// mode of that drift is a privilege change happening with no audit entry, which
// is silent by definition.
const AUDIT_ACTIONS_BY_ADMIN_ACTION = {
  approve: "admin.user.approve",
  disable: "admin.user.disable",
  enable: "admin.user.enable",
  verify: "admin.user.verify",
  promote: "admin.user.promote",
  demote: "admin.user.demote",
  editProfile: "admin.user.edit_profile",
} as const satisfies Record<string, AuditAction>;

type AdminUserAction = keyof typeof AUDIT_ACTIONS_BY_ADMIN_ACTION;

const VALID_ACTIONS = new Set<string>(Object.keys(AUDIT_ACTIONS_BY_ADMIN_ACTION));
const VALID_ACTIONS_MESSAGE = `Invalid action. Use: ${Object.keys(AUDIT_ACTIONS_BY_ADMIN_ACTION).join(", ")}`;

function isAdminUserAction(value: unknown): value is AdminUserAction {
  return typeof value === "string" && VALID_ACTIONS.has(value);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimitCaller("admin-users", session);
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return apiError("Invalid user id", 400);
    }

    const body = await request.json();
    const { action } = body as { action: unknown };
    if (!isAdminUserAction(action)) {
      return apiError(VALID_ACTIONS_MESSAGE, 400);
    }

    await connectDB();

    const target = await User.findById(id);
    if (!target) return apiError("User not found", 404);

    // Prevent self-modification
    if (target._id.toString() === session.user.id) {
      return apiError("Cannot modify your own account this way", 400);
    }

    const before = {
      status: target.status,
      role: target.role,
      isVerified: target.isVerified,
      username: target.username,
      email: target.email,
    };

    switch (action) {
      case "approve":
        target.status = "approved";
        // Notify the user their account is approved (non-blocking)
        sendApprovalEmail(target.email, target.username).catch((notifyErr: unknown) =>
          captureError(notifyErr, { route: "admin/users/[id]", stage: "approval-notify" })
        );
        break;
      case "disable":
        target.status = "disabled";
        break;
      case "enable":
        target.status = "approved";
        break;
      case "verify":
        target.isVerified = true;
        target.verificationToken = undefined;
        target.verificationExpires = undefined;
        break;
      case "promote":
        target.role = "admin";
        break;
      case "demote":
        target.role = "user";
        break;
      case "editProfile": {
        const parsed = adminEditProfileSchema.safeParse(body);
        if (!parsed.success) {
          return apiError(parsed.error.issues[0].message, 400);
        }
        const { username, email } = parsed.data;
        if (username) {
          const dup = await User.findOne({ username, _id: { $ne: target._id } });
          if (dup) return apiError("Username already taken", 409);
          target.username = username;
        }
        if (email) {
          const dup = await User.findOne({ email: email.toLowerCase(), _id: { $ne: target._id } });
          if (dup) return apiError("Email already taken", 409);
          target.email = email.toLowerCase();
        }
        break;
      }
      default:
        return apiError(VALID_ACTIONS_MESSAGE, 400);
    }

    await target.save();

    // The outcome is deliberately ignored: the change above has already
    // committed, so failing the request here would report failure for work that
    // actually happened. `admin/clicks:GET` is the sole route that fails closed
    // instead, because nothing has been disclosed at its call site yet.
    await recordAudit({
      request,
      actor: session.user,
      action: AUDIT_ACTIONS_BY_ADMIN_ACTION[action],
      subjectType: "user",
      subjectIds: [target._id.toString()],
      route: "admin/users/[id]:PATCH",
      detail: {
        statusBefore: before.status,
        statusAfter: target.status,
        roleBefore: before.role,
        roleAfter: target.role,
        verifiedBefore: before.isVerified,
        verifiedAfter: target.isVerified,
        usernameBefore: before.username,
        usernameAfter: target.username,
        // Whether the address changed, never the address itself. The username
        // identifies the account well enough for an investigation, and copying
        // an email into a second collection would duplicate personal data for
        // no additional forensic value.
        emailChanged: before.email !== target.email,
      },
    });

    return apiSuccess({
      id: target._id,
      username: target.username,
      email: target.email,
      role: target.role,
      isVerified: target.isVerified,
      status: target.status,
    });
  } catch (err) {
    captureError(err, { route: "admin/users/[id]:PATCH" });
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimitCaller("admin-users", session);
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const { id } = await params;

    await connectDB();

    const target = await User.findById(id);
    if (!target) return apiError("User not found", 404);

    if (target._id.toString() === session.user.id) {
      return apiError("Cannot delete your own account", 400);
    }

    // Their custom domains go with the account. Leaving the Domain records
    // behind would keep the hostnames claimed by a user who no longer exists,
    // and leaving the links live would hand them to whoever claims the hostname
    // next, so each hostname is released and its links stamped as detached.
    //
    // Every Vercel detach must succeed BEFORE any local mutation runs. If one
    // fails partway through, the domains already detached at Vercel cannot be
    // undone, but the local records for those and every other domain, the
    // links, and the user itself are all left untouched, so the admin can
    // simply retry the deletion rather than having to reconcile a half-done
    // state by hand.
    const domains = await Domain.find({ owner: target._id })
      .select("hostname vercelDomainId")
      .lean();

    for (const d of domains) {
      // Only ever call Vercel for a domain this app actually attached, which
      // is exactly the domains that reached provisioning and so carry a
      // `vercelDomainId`. A `pending_dns` or `failed` record proves no
      // ownership whatsoever: without this guard, an admin deleting a user
      // could detach an unrelated hostname that happens to sit on the same
      // Vercel project, taking that site offline.
      if (!d.vercelDomainId) continue;

      const removed = await removeDomain(d.hostname);
      if (!removed.ok) {
        captureError(new Error(`Vercel refused to remove domain: ${removed.code}`), {
          route: "admin/users/[id]:DELETE",
          vercelCode: removed.code,
          hostname: d.hostname,
        });
        return apiError(
          `Could not detach domain "${d.hostname}" from the platform. User deletion was aborted; retry once the domain can be detached.`,
          502
        );
      }
    }

    for (const d of domains) {
      await detachLinksForHostname(d.hostname);
      await invalidateDomainStatus(d.hostname);
    }
    await Domain.deleteMany({ owner: target._id });

    // Unlink their links (set owner to null) rather than deleting them
    await Link.updateMany({ owner: target._id }, { $set: { owner: null } });

    await User.deleteOne({ _id: target._id });

    // Written after the deletion has actually happened, so the trail never
    // claims an account was removed when the Vercel detach above aborted the
    // whole operation. The user id is kept even though the document is gone:
    // it is the only stable handle left for the domains and links that
    // referenced it.
    // The outcome is deliberately ignored: the change above has already
    // committed, so failing the request here would report failure for work that
    // actually happened. `admin/clicks:GET` is the sole route that fails closed
    // instead, because nothing has been disclosed at its call site yet.
    await recordAudit({
      request,
      actor: session.user,
      action: "admin.user.delete",
      subjectType: "user",
      subjectIds: [target._id.toString()],
      route: "admin/users/[id]:DELETE",
      detail: {
        username: target.username,
        role: target.role,
        status: target.status,
        domainsReleased: domains.length,
        hostnames: domains.map((d) => d.hostname).join(", "),
      },
    });

    return apiSuccess({
      message: `User ${target.username} deleted`,
      domainsReleased: domains.length,
    });
  } catch (err) {
    if (err instanceof VercelDomainsError) {
      captureError(err, { route: "admin/users/[id]:DELETE", vercelCode: err.code });
      return apiError("Domain management is temporarily unavailable", 503);
    }
    captureError(err, { route: "admin/users/[id]:DELETE" });
    return apiError("Internal server error", 500);
  }
}
