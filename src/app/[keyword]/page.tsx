import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { encryptIP } from "@/lib/ip";
import { UAParser } from "ua-parser-js";

/**
 * Server-rendered fallback for short-link resolution — only reached when
 * proxy.ts's call to /api/internal/resolve is unreachable (cold start,
 * timeout, network error). Mirrors that route's lookup and expiry/password
 * semantics directly against MongoDB.
 */
export default async function KeywordPage({
  params,
}: {
  params: Promise<{ keyword: string }>;
}) {
  const { keyword } = await params;

  await connectDB();

  const link = await Link.findOne({ keyword }).lean();
  if (!link) {
    notFound();
  }

  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    notFound();
  }

  if (link.isPasswordProtected) {
    redirect(`/password/${keyword}`);
  }

  const requestHeaders = await headers();
  const clientIP = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = requestHeaders.get("user-agent") || "";
  const referrer = requestHeaders.get("referer") || "";
  const countryCode = requestHeaders.get("x-vercel-ip-country") || "";

  const ua = UAParser(userAgent);
  const browser = ua.browser.name || "";
  const os = ua.os.name || "";
  const { iv: ipIv, ciphertext: ipRaw } =
    clientIP !== "unknown" ? encryptIP(clientIP) : { iv: "", ciphertext: "" };

  // Fire-and-forget click logging — never block the redirect on it.
  Promise.all([
    Click.create({
      keyword,
      referrer,
      userAgent,
      ipRaw,
      ipIv,
      countryCode,
      browser,
      os,
    }),
    Link.updateOne({ keyword }, { $inc: { clicks: 1 } }),
  ]).catch(() => {});

  redirect(link.url);
}
