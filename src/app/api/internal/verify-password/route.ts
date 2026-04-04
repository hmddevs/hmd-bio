import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { rateLimit } from "@/lib/api/rate-limit";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 password attempts per IP per minute
    const clientIP =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = rateLimit(`verify-pw:${clientIP}`, {
      limit: 5,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return apiError("Too many attempts. Try again later.", 429);
    }

    const { keyword, password } = await request.json();
    if (!keyword || !password) {
      return apiError("Keyword and password required", 400);
    }

    await connectDB();

    const link = await Link.findOne({ keyword }).select("+password").lean();
    if (!link) {
      return apiError("Link not found", 404);
    }

    if (!link.isPasswordProtected || !link.password) {
      return apiSuccess({ url: link.url });
    }

    const valid = await bcrypt.compare(password, link.password);
    if (!valid) {
      return apiError("Incorrect password", 403);
    }

    return apiSuccess({ url: link.url });
  } catch (err) {
    console.error("Verify password error:", err);
    return apiError("Internal server error", 500);
  }
}
