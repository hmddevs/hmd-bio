import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api-response";
import { hashIP } from "@/lib/ip";
import { encrypt } from "@/lib/encryption";
import { UAParser } from "ua-parser-js";
import { invalidateCachedLink } from "@/lib/cache";

/**
 * Webhook endpoint for real-time YOURLS → MongoDB sync.
 * Called by the YOURLS mongodb-sync plugin on every click and link creation.
 *
 * Headers:  x-sync-secret — shared secret for authentication
 * Body:     { event: "click" | "link", data: { ... } }
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return apiError("Sync not configured", 503);
  }

  const provided = request.headers.get("x-sync-secret");
  if (!provided || provided !== secret) {
    return apiError("Unauthorized", 401);
  }

  let body: { event: string; data: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const { event, data } = body;
  if (!event || !data) {
    return apiError("Missing event or data", 400);
  }

  await connectDB();

  try {
    if (event === "click") {
      const { keyword, referrer, userAgent, ip, countryCode, clickTime } =
        data as {
          keyword: string;
          referrer?: string;
          userAgent?: string;
          ip?: string;
          countryCode?: string;
          clickTime?: string;
        };

      if (!keyword) return apiError("Missing keyword", 400);

      const ua = UAParser(userAgent || "");

      const hasKey = !!process.env.IP_ENCRYPTION_KEY;
      const encrypted = hasKey && ip ? encrypt(ip) : null;

      await Promise.all([
        Click.create({
          keyword,
          referrer: referrer || "",
          userAgent: userAgent || "",
          ip: hashIP(ip || ""),
          ...(encrypted && { ipRaw: encrypted.ciphertext, ipIv: encrypted.iv }),
          countryCode: countryCode || "",
          browser: ua.browser.name || "",
          os: ua.os.name || "",
          createdAt: clickTime ? new Date(clickTime) : new Date(),
        }),
        Link.updateOne({ keyword }, { $inc: { clicks: 1 } }),
      ]);

      return apiSuccess({ synced: "click", keyword });
    }

    if (event === "link") {
      const { keyword, url, title, ip, clicks, timestamp } = data as {
        keyword: string;
        url: string;
        title?: string;
        ip?: string;
        clicks?: number;
        timestamp?: string;
      };

      if (!keyword || !url) return apiError("Missing keyword or url", 400);

      await Link.updateOne(
        { keyword },
        {
          $setOnInsert: {
            keyword,
            url,
            title: title || "",
            ip: ip || "",
            clicks: clicks || 0,
            statusCode: 301,
            isPasswordProtected: false,
            createdAt: timestamp ? new Date(timestamp) : new Date(),
          },
        },
        { upsert: true }
      );

      invalidateCachedLink(keyword).catch(() => {});
      return apiSuccess({ synced: "link", keyword });
    }

    if (event === "update_clicks") {
      // Bulk click count sync — optional heartbeat from YOURLS
      const { keyword, clicks } = data as { keyword: string; clicks: number };
      if (!keyword) return apiError("Missing keyword", 400);

      await Link.updateOne({ keyword }, { $set: { clicks } });
      invalidateCachedLink(keyword).catch(() => {});
      return apiSuccess({ synced: "update_clicks", keyword });
    }

    return apiError(`Unknown event: ${event}`, 400);
  } catch (err) {
    console.error("Sync error:", err);
    return apiError("Sync failed", 500);
  }
}
