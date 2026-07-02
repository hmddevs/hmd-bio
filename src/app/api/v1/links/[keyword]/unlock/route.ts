import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { hashIP } from "@/lib/ip";
import bcrypt from "bcryptjs";

/**
 * Public endpoint: verifies a short link's password. Fetched directly from
 * the browser by the /password/[keyword] page, so it deliberately carries
 * no INTERNAL_SECRET check — only a strict rate limit against brute force.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  try {
    const { keyword } = await params;

    // Rate limit: 5 password attempts per IP per minute
    const clientIP =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = await rateLimit(`unlock:${hashIP(clientIP)}`, {
      limit: 5,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return apiError("Too many attempts. Try again later.", 429);
    }

    const { password } = await request.json();
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
    captureError(err, { route: "v1/links/unlock" });
    return apiError("Internal server error", 500);
  }
}
