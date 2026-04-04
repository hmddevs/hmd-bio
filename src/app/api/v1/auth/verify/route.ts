import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { apiError } from "@/lib/api/api-response";
import { sendAdminApprovalRequest } from "@/lib/integrations/email";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return apiError("Missing verification token", 400);
  }

  try {
    await connectDB();

    const user = await User.findOne({
      verificationToken: token,
      verificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return apiError("Invalid or expired verification token", 400);
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();

    // Notify admin about new account pending approval (non-blocking)
    sendAdminApprovalRequest(user.username, user.email).catch((err) =>
      console.error("Failed to notify admin:", err)
    );

    // Redirect to login with success message
    const base = (process.env.AUTH_URL || "https://hmd.bio")
      .trim()
      .replace(/\/+$/, "");
    return Response.redirect(`${base}/login?verified=1&pending=1`, 302);
  } catch (err) {
    console.error("Verify error:", err);
    return apiError("Internal server error", 500);
  }
}
