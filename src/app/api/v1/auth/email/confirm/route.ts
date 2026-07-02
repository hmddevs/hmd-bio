import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { captureError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const base = (process.env.AUTH_URL || "https://hmd.bio")
    .trim()
    .replace(/\/+$/, "");

  if (!token) {
    return NextResponse.redirect(`${base}/login?emailChange=invalid`);
  }

  try {
    await connectDB();

    const user = await User.findOne({
      emailChangeToken: token,
      emailChangeExpires: { $gt: new Date() },
    });

    if (!user) {
      return NextResponse.redirect(`${base}/login?emailChange=expired`);
    }

    if (!user.pendingEmail) {
      return NextResponse.redirect(`${base}/login?emailChange=invalid`);
    }

    // Check the new email isn't taken (race condition guard)
    const existing = await User.findOne({ email: user.pendingEmail, _id: { $ne: user._id } });
    if (existing) {
      user.pendingEmail = undefined;
      user.emailChangeToken = undefined;
      user.emailChangeExpires = undefined;
      await user.save();
      return NextResponse.redirect(`${base}/login?emailChange=taken`);
    }

    // Apply the email change
    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
    user.emailChangeToken = undefined;
    user.emailChangeExpires = undefined;
    await user.save();

    return NextResponse.redirect(`${base}/login?emailChange=success`);
  } catch (err) {
    captureError(err, { route: "auth/email/confirm" });
    return NextResponse.redirect(`${base}/login?emailChange=error`);
  }
}
