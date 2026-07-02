import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { sendApprovalEmail } from "@/lib/email";
import { adminEditProfileSchema } from "@/lib/validations";
import mongoose from "mongoose";

const VALID_ACTIONS = new Set([
  "approve",
  "disable",
  "enable",
  "verify",
  "promote",
  "demote",
  "editProfile",
]);

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

  const rl = await rateLimit(`admin-users:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return apiError("Invalid user id", 400);
    }

    const body = await request.json();
    const { action } = body as { action: string };
    if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
      return apiError("Invalid action. Use: approve, disable, enable, verify, promote, demote, editProfile", 400);
    }

    await connectDB();

    const target = await User.findById(id);
    if (!target) return apiError("User not found", 404);

    // Prevent self-modification
    if (target._id.toString() === session.user.id) {
      return apiError("Cannot modify your own account this way", 400);
    }

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
        return apiError("Invalid action. Use: approve, disable, enable, verify, promote, demote, editProfile", 400);
    }

    await target.save();

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

  const rl = await rateLimit(`admin-users:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const { id } = await params;

    await connectDB();

    const target = await User.findById(id);
    if (!target) return apiError("User not found", 404);

    if (target._id.toString() === session.user.id) {
      return apiError("Cannot delete your own account", 400);
    }

    // Unlink their links (set owner to null) rather than deleting them
    await Link.updateMany({ owner: target._id }, { $set: { owner: null } });

    await User.deleteOne({ _id: target._id });

    return apiSuccess({ message: `User ${target.username} deleted` });
  } catch (err) {
    captureError(err, { route: "admin/users/[id]:DELETE" });
    return apiError("Internal server error", 500);
  }
}
