import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { changePasswordSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireSession } from "@/lib/api-auth";
import { rateLimitCaller } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import bcrypt from "bcryptjs";

export async function PUT(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  // The account password is a credential, and credential management is
  // session-only for the same reason key management is: a key must not be able
  // to alter the account it was issued from. The current password is still
  // required below, so a key was never a takeover on its own, but it did make
  // this endpoint an online guessing oracle that a revoked-key holder could
  // drive, distinguishable by 403 against 200 and bounded only by the ordinary
  // authenticated rate limit.
  const notASession = requireSession(session);
  if (notASession) return notASession;

  const rl = await rateLimitCaller("change-password", session);
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
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
    captureError(err, { route: "v1/auth/password" });
    return apiError("Internal server error", 500);
  }
}
