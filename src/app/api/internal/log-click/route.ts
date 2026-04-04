import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { hashIP } from "@/lib/ip";
import { encrypt } from "@/lib/integrations/encryption";
import { UAParser } from "ua-parser-js";

/**
 * Fire-and-forget click logging endpoint.
 * Called by edge middleware after redirect — does not block the user.
 */
export async function POST(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (internalSecret) {
    const provided = request.headers.get("x-internal-secret");
    if (provided !== internalSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const { keyword, ip, userAgent, referrer, countryCode } =
      await request.json();

    if (!keyword) {
      return Response.json({ error: "Missing keyword" }, { status: 400 });
    }

    const rawIP = ip || "unknown";
    const ua = UAParser(userAgent || "");
    const browser = ua.browser.name || "";
    const os = ua.os.name || "";

    const hasKey = !!process.env.IP_ENCRYPTION_KEY;
    const encrypted = hasKey ? encrypt(rawIP) : null;

    await connectDB();

    await Promise.all([
      Click.create({
        keyword,
        referrer: referrer || "",
        userAgent: userAgent || "",
        ip: hashIP(rawIP),
        ...(encrypted && { ipRaw: encrypted.ciphertext, ipIv: encrypted.iv }),
        countryCode: countryCode || "",
        browser,
        os,
      }),
      Link.updateOne({ keyword }, { $inc: { clicks: 1 } }),
    ]);

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Click logging error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
