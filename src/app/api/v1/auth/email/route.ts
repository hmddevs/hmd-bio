import { NextRequest } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { changeEmailSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { auth } from "@/lib/auth";
import { sendEmailChangeConfirmation } from "@/lib/integrations/email";

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const body = await request.json();
    const parsed = changeEmailSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { newEmail, currentPassword } = parsed.data;

    await connectDB();

    const user = await User.findOne({ username: session.user.name });
    if (!user) {
      return apiError("User not found", 404);
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return apiError("Current password is incorrect", 403);
    }

    // Check if new email is the same as current
    if (user.email === newEmail.toLowerCase()) {
      return apiError("New email is the same as your current email", 400);
    }

    // Check if new email is already in use
    const existing = await User.findOne({ email: newEmail.toLowerCase() });
    if (existing) {
      return apiError("Email is already in use", 409);
    }

    // Generate token and save pending email
    const token = crypto.randomBytes(32).toString("hex");
    user.pendingEmail = newEmail.toLowerCase();
    user.emailChangeToken = token;
    user.emailChangeExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send confirmation email to CURRENT email address
    const sent = await sendEmailChangeConfirmation(
      user.email,
      newEmail,
      token
    );

    if (!sent) {
      return apiError("Failed to send confirmation email. Try again later.", 500);
    }

    return apiSuccess({
      message: "A confirmation email has been sent to your current email address.",
    });
  } catch (err) {
    console.error("Change email error:", err);
    return apiError("Internal server error", 500);
  }
}
