import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { changePasswordSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { auth } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    await connectDB();

    const user = await User.findOne({ username: session.user.name });
    if (!user) {
      return apiError("User not found", 404);
    }

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      return apiError("Current password is incorrect", 403);
    }

    user.passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await user.save();

    return apiSuccess({ message: "Password changed successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    return apiError("Internal server error", 500);
  }
}
