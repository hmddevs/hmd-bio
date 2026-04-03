import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireAdmin } from "@/lib/auth";

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
      case "disable":
        target.isDisabled = true;
        break;
      case "enable":
        target.isDisabled = false;
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
      default:
        return apiError("Invalid action. Use: disable, enable, verify, promote, demote", 400);
    }

    await target.save();

    return apiSuccess({
      id: target._id,
      username: target.username,
      role: target.role,
      isVerified: target.isVerified,
      isDisabled: target.isDisabled,
    });
  } catch (err) {
    console.error("Admin user action error:", err);
    return apiError("Internal server error", 500);
  }
}
