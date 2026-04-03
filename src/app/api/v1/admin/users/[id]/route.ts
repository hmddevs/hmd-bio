import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireAdmin } from "@/lib/auth";
import { sendApprovalEmail } from "@/lib/email";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body as { action: string };

    await connectDB();

    const target = await User.findById(id);
    if (!target) return apiError("User not found", 404);

    // Prevent self-modification
    if (target._id.toString() === user.id) {
      return apiError("Cannot modify your own account this way", 400);
    }

    switch (action) {
      case "approve":
        target.status = "approved";
        await target.save();
        // Send approval notification email
        sendApprovalEmail(target.email, target.username).catch(() => {});
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
        const { username, email } = body as { username?: string; email?: string };
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
    console.error("Admin user action error:", err);
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  try {
    const { id } = await params;

    await connectDB();

    const target = await User.findById(id);
    if (!target) return apiError("User not found", 404);

    if (target._id.toString() === user.id) {
      return apiError("Cannot delete your own account", 400);
    }

    // Unlink their links (set owner to null) rather than deleting them
    await Link.updateMany({ owner: target._id }, { $set: { owner: null } });

    await User.deleteOne({ _id: target._id });

    return apiSuccess({ message: `User ${target.username} deleted` });
  } catch (err) {
    console.error("Admin user delete error:", err);
    return apiError("Internal server error", 500);
  }
}
