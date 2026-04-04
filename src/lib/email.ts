import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || "HMD.bio <no-reply@hmd.bio>";
const FALLBACK_FROM = "HMD.bio <onboarding@resend.dev>";

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      ...params,
    });

    if (error) {
      // If domain not verified, try fallback Resend test domain
      if (error.message?.includes("not verified")) {
        console.warn(`Primary domain not verified, falling back to ${FALLBACK_FROM}`);
        const { error: fallbackError } = await resend.emails.send({
          from: FALLBACK_FROM,
          ...params,
        });
        if (fallbackError) {
          console.error("Fallback email send error:", fallbackError);
          return false;
        }
        return true;
      }
      console.error("Email send error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Email service error:", err);
    return false;
  }
}

export async function sendVerificationEmail(
  to: string,
  token: string
): Promise<boolean> {
  const base = (process.env.AUTH_URL || "https://hmd.bio")
    .trim()
    .replace(/\/+$/, "");
  const verifyUrl = `${base}/api/v1/auth/verify?token=${token}`;

  return sendEmail({
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
}

export async function sendApprovalEmail(
  to: string,
  username: string
): Promise<boolean> {
  const base = (process.env.AUTH_URL || "https://hmd.bio")
    .trim()
    .replace(/\/+$/, "");

  return sendEmail({
    to,
    subject: "Your HMD.bio account has been approved",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #fff; margin-bottom: 8px;">HMD<span style="color: #6366f1;">.bio</span></h2>
        <p style="color: #a1a1aa; margin-bottom: 24px;">Hi <strong>${username}</strong>, your account has been approved! You can now sign in and start using HMD.bio.</p>
        <a href="${base}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Go to HMD.bio</a>
      </div>
    `,
  });
}

export async function sendAdminApprovalRequest(
  username: string,
  email: string
): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL || "heimdall@hmddevs.org";
  const base = (process.env.AUTH_URL || "https://hmd.bio")
    .trim()
    .replace(/\/+$/, "");

  return sendEmail({
    to: adminEmail,
    subject: `HMD.bio — New account pending approval: ${username}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #fff; margin-bottom: 8px;">HMD<span style="color: #6366f1;">.bio</span></h2>
        <p style="color: #a1a1aa; margin-bottom: 24px;">A new user has verified their email and is waiting for your approval.</p>
        <table style="color: #d4d4d8; font-size: 14px; margin-bottom: 24px;">
          <tr><td style="padding: 4px 12px 4px 0; color: #71717a;">Username</td><td><strong>${username}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #71717a;">Email</td><td>${email}</td></tr>
        </table>
        <a href="${base}/admin" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Review in Admin Panel</a>
      </div>
    `,
  });
}

export async function sendEmailChangeConfirmation(
  to: string,
  newEmail: string,
  token: string
): Promise<boolean> {
  const base = (process.env.AUTH_URL || "https://hmd.bio")
    .trim()
    .replace(/\/+$/, "");
  const confirmUrl = `${base}/api/v1/auth/email/confirm?token=${token}`;

  return sendEmail({
    to,
    subject: "Confirm your email change on HMD.bio",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #fff; margin-bottom: 8px;">HMD<span style="color: #6366f1;">.bio</span></h2>
        <p style="color: #a1a1aa; margin-bottom: 24px;">A request was made to change your email address to <strong>${newEmail}</strong>.</p>
        <p style="color: #a1a1aa; margin-bottom: 24px;">Click below to confirm this change:</p>
        <a href="${confirmUrl}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Confirm Email Change</a>
        <p style="color: #71717a; font-size: 13px; margin-top: 24px;">If the button doesn't work, copy this link:<br/>${confirmUrl}</p>
        <p style="color: #71717a; font-size: 12px; margin-top: 32px;">This link expires in 1 hour. If you didn't request this change, you can safely ignore this email.</p>
      </div>
    `,
  });
}
