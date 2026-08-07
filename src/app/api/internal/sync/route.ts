import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api-response";
import { encryptIP } from "@/lib/ip";
import { captureError } from "@/lib/errors";
import { timingSafeEqualStr } from "@/lib/utils";
import { PRIMARY_DOMAIN } from "@/lib/domains";
import {
  syncClickSchema,
  syncLinkSchema,
  syncUpdateClicksSchema,
} from "@/lib/validations";
import { UAParser } from "ua-parser-js";
import { z } from "zod";

/**
 * The outer shape only. Each event's own payload is parsed by its own schema in
 * the branch that handles it, because the three carry different fields and a
 * single permissive schema would be back to trusting the body.
 */
const syncEnvelopeSchema = z.object({
  event: z.string().min(1, "Missing event").max(50),
  data: z.record(z.string(), z.unknown()),
});

/**
 * Webhook endpoint for real-time YOURLS → MongoDB sync.
 * Called by the YOURLS mongodb-sync plugin on every click and link creation.
 *
 * Headers:  x-sync-secret — shared secret for authentication
 * Body:     { event: "click" | "link", data: { ... } }
 *
 * YOURLS only ever served the primary domain, so every query here is pinned to
 * PRIMARY_DOMAIN explicitly. It must never be able to reach a tenant's link
 * that happens to share a keyword.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return apiError("Sync not configured", 503);
  }

  const provided = request.headers.get("x-sync-secret");
  if (!provided || !timingSafeEqualStr(provided, secret)) {
    return apiError("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const envelope = syncEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return apiError(envelope.error.issues[0].message, 400);
  }
  const { event, data } = envelope.data;

  await connectDB();

  try {
    if (event === "click") {
      // Every field below is schema-parsed before it reaches a query or a
      // document. `keyword` above all: this is the only keyword-taking surface
      // in the codebase that reads from a JSON body rather than a path or
      // search parameter, so it was the only one where an object could arrive
      // and turn the filter into `{ keyword: { $ne: null } }`.
      const parsed = syncClickSchema.safeParse(data);
      if (!parsed.success) {
        return apiError(parsed.error.issues[0].message, 400);
      }
      const { keyword, referrer, userAgent, ip, countryCode, clickTime } = parsed.data;

      const ua = UAParser(userAgent || "");
      const { iv: ipIv, ciphertext: ipRaw } = ip
        ? encryptIP(ip)
        : { iv: "", ciphertext: "" };

      await Promise.all([
        Click.create({
          domain: PRIMARY_DOMAIN,
          keyword,
          referrer: referrer || "",
          userAgent: userAgent || "",
          ipRaw,
          ipIv,
          countryCode: countryCode || "",
          browser: ua.browser.name || "",
          os: ua.os.name || "",
          createdAt: clickTime ?? new Date(),
        }),
        Link.updateOne({ domain: PRIMARY_DOMAIN, keyword }, { $inc: { clicks: 1 } }),
      ]);

      return apiSuccess({ synced: "click", keyword });
    }

    if (event === "link") {
      // An upsert, so this branch is a writer, and until now the last one that
      // could mint a keyword beginning with a matcher-excluded name. Such a
      // link never reaches the middleware and therefore never meets the resolve
      // endpoint's rate limit. `chosenKeywordSchema` is the same rule the
      // public writers apply.
      const parsed = syncLinkSchema.safeParse(data);
      if (!parsed.success) {
        return apiError(parsed.error.issues[0].message, 400);
      }
      const { keyword, url, title, ip, clicks, timestamp } = parsed.data;

      const { iv: ipIv, ciphertext: ipRaw } = ip
        ? encryptIP(ip)
        : { iv: "", ciphertext: "" };

      await Link.updateOne(
        { domain: PRIMARY_DOMAIN, keyword },
        {
          $setOnInsert: {
            domain: PRIMARY_DOMAIN,
            keyword,
            url,
            title: title || "",
            ipRaw,
            ipIv,
            clicks: clicks || 0,
            statusCode: 301,
            isPasswordProtected: false,
            createdAt: timestamp ?? new Date(),
          },
        },
        { upsert: true }
      );

      return apiSuccess({ synced: "link", keyword });
    }

    if (event === "update_clicks") {
      // Bulk click count sync — optional heartbeat from YOURLS
      const parsed = syncUpdateClicksSchema.safeParse(data);
      if (!parsed.success) {
        return apiError(parsed.error.issues[0].message, 400);
      }
      const { keyword, clicks } = parsed.data;

      await Link.updateOne({ domain: PRIMARY_DOMAIN, keyword }, { $set: { clicks } });
      return apiSuccess({ synced: "update_clicks", keyword });
    }

    return apiError(`Unknown event: ${event}`, 400);
  } catch (err) {
    captureError(err, { route: "internal/sync", event });
    return apiError("Sync failed", 500);
  }
}
