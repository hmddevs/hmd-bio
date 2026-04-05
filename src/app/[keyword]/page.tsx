import { redirect, notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { hashIP } from "@/lib/ip";
import { encrypt } from "@/lib/integrations/encryption";
import { UAParser } from "ua-parser-js";
import { setCachedLink, type CachedLink } from "@/lib/integrations/cache";

export const dynamic = "force-dynamic";

/**
 * Server-side fallback for short link resolution.
 * Catches requests that the edge proxy couldn't resolve (e.g. cold start,
 * MongoDB timeout, network failure between edge and serverless).
 * Connects to MongoDB directly — no HTTP hop required.
 */
export default async function ShortLinkFallback({
  params,
}: {
  params: Promise<{ keyword: string }>;
}) {
  const { keyword } = await params;

  if (!keyword || keyword.includes(".")) notFound();

  await connectDB();
  const link = await Link.findOne({ keyword }).lean();

  if (!link) notFound();
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) notFound();

  if (link.isPasswordProtected) {
    redirect(`/password/${keyword}`);
  }

  // Populate Redis cache so the proxy fast-path works next time
  const linkData: CachedLink = {
    url: link.url,
    statusCode: link.statusCode || 302,
    isPasswordProtected: false,
  };
  setCachedLink(keyword, linkData).catch(() => {});

  // Log click (best-effort, fire-and-forget)
  try {
    const headersList = await headers();
    const rawIP =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = headersList.get("user-agent") || "";
    const referrer = headersList.get("referer") || "";
    const countryCode = headersList.get("x-vercel-ip-country") || "";

    const ua = UAParser(userAgent);
    const hasKey = !!process.env.IP_ENCRYPTION_KEY;
    const encrypted = hasKey ? encrypt(rawIP) : null;

    Promise.all([
      Click.create({
        keyword,
        referrer,
        userAgent,
        ip: hashIP(rawIP),
        ...(encrypted && { ipRaw: encrypted.ciphertext, ipIv: encrypted.iv }),
        countryCode,
        browser: ua.browser.name || "",
        os: ua.os.name || "",
      }),
      Link.updateOne({ keyword }, { $inc: { clicks: 1 } }),
    ]).catch(() => {});
  } catch {
    // Click logging is non-critical
  }

  if (link.statusCode === 301) {
    permanentRedirect(link.url);
  }
  redirect(link.url);
}
