import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
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
