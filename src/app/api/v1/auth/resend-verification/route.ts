import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { apiSuccess, apiError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/email";
import { randomBytes } from "crypto";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(`resend-verify:${ip}`, { limit: 3, windowMs: 300_000 });
  if (!rl.allowed) {
    return apiError("Too many requests. Try again in a few minutes.", 429);
  }

  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return apiError("Email is required", 400);
    }

    await connectDB();

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always return success to prevent email enumeration
    if (!user || user.isVerified) {
      return apiSuccess({
        message: "If an unverified account exists with that email, a new verification link has been sent.",
      });
    }

    // Generate new token
    const verificationToken = randomBytes(32).toString("hex");
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.verificationToken = verificationToken;
    user.verificationExpires = verificationExpires;
    await user.save();

    await sendVerificationEmail(email, verificationToken);

    return apiSuccess({
      message: "If an unverified account exists with that email, a new verification link has been sent.",
    });
  } catch (err) {
    console.error("Resend verification error:", err);
    return apiError("Internal server error", 500);
  }
}
