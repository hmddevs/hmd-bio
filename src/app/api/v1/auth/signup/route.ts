import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { signupSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { isReservedKeyword } from "@/lib/utils";
import { sendVerificationEmail } from "@/lib/email";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 reg/min per IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = rateLimit(`signup:${ip}`, { limit: 5, windowMs: 60_000 });
    if (!rl.allowed) {
      return apiError("Rate limit exceeded. Try again later.", 429);
    }

    const body = await request.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { email, username, password } = parsed.data;

    // Block reserved keywords as usernames
    if (isReservedKeyword(username)) {
      return apiError("This username is not available", 400);
    }

    await connectDB();

    // Check existing email/username
    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username }],
    }).lean();
    if (existing) {
      return apiError("Email or username already taken", 409);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = randomBytes(32).toString("hex");
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await User.create({
      username,
      email: email.toLowerCase(),
      passwordHash,
      role: "user",
      isVerified: false,
      status: "pending",
      verificationToken,
      verificationExpires,
    });

    // Send verification email (non-blocking on failure)
    const emailSent = await sendVerificationEmail(email, verificationToken);

    return apiSuccess(
      {
        message: emailSent
          ? "Account created. Check your email to verify. After verification, an admin will review your account."
          : "Account created. Verification email could not be sent — contact support.",
        username,
      },
      201
    );
  } catch (err) {
    console.error("Signup error:", err);
    return apiError("Internal server error", 500);
  }
}
