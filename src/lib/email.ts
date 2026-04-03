import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || "HMD.bio <noreply@hmd.bio>";

export async function sendVerificationEmail(
  to: string,
  token: string
): Promise<boolean> {
  const base = (process.env.AUTH_URL || "https://hmd.bio")
    .trim()
    .replace(/\/+$/, "");
  const verifyUrl = `${base}/api/v1/auth/verify?token=${token}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: "Verify your HMD.bio account",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #fff; margin-bottom: 8px;">HMD<span style="color: #6366f1;">.bio</span></h2>
          <p style="color: #a1a1aa; margin-bottom: 24px;">Verify your email address to activate your account.</p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Verify Email</a>
          <p style="color: #71717a; font-size: 13px; margin-top: 24px;">If the button doesn't work, copy this link:<br/>${verifyUrl}</p>
          <p style="color: #71717a; font-size: 12px; margin-top: 32px;">This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error("Email send error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Email service error:", err);
    return false;
  }
}
