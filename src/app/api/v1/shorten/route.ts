import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Option } from "@/models/Option";
import { shortenSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import {
  generateKeyword,
  isReservedKeyword,
  isAllowedProtocol,
  fetchPageTitle,
  verifyTurnstile,
  generateKeywordSuggestions,
  numberToBase62,
} from "@/lib/utils";
import { authenticateRequest } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { setCachedLink } from "@/lib/cache";
import { formatResponse } from "@/lib/format-response";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const body = await request.json();
    const parsed = shortenSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { url, keyword: customKeyword, title, turnstileToken } = parsed.data;

    // Auth policy:
    // - Authenticated (session or API key): no Turnstile needed
    // - Public / anonymous: Turnstile required
    const user = await authenticateRequest(request);

    if (!user) {
      // Public / anonymous — Turnstile required
      const secretKey = process.env.TURNSTILE_SECRET_KEY;
      if (secretKey) {
        if (!turnstileToken) {
          return apiError("Turnstile token required", 403);
        }
        const valid = await verifyTurnstile(turnstileToken, secretKey);
        if (!valid) {
          return apiError("Turnstile verification failed", 403);
        }
      }
    }

    // Rate limit: 100/min for authenticated users, 30/min for anonymous
    const rateKey = user ? `shorten:user:${user.id}` : `shorten:${ip}`;
    const rateMax = user ? 100 : 30;
    const rl = rateLimit(rateKey, { limit: rateMax, windowMs: 60_000 });
    if (!rl.allowed) {
      return apiError("Rate limit exceeded. Try again later.", 429);
    }

    // Protocol check
    if (!isAllowedProtocol(url)) {
      return apiError("URL protocol not allowed", 400);
    }

    await connectDB();

    // Generate or validate keyword
    let keyword = customKeyword?.trim() || "";

    if (!keyword) {
      // Check if sequential mode is enabled
      const modeOption = await Option.findOne({ key: "keywordMode" }).lean();
      const mode = (modeOption?.value as string) || "random";

      if (mode === "sequential") {
        const counter = await Option.findOneAndUpdate(
          { key: "nextSequentialId" },
          { $inc: { value: 1 } },
          { upsert: true, new: true }
        );
        keyword = numberToBase62(counter.value as number);
      } else {
        keyword = generateKeyword();
      }
    }

    if (isReservedKeyword(keyword)) {
      return apiError("This keyword is reserved", 400);
    }

    // Check if keyword is available (retry with random if auto-generated)
    let existing = await Link.findOne({ keyword }).lean();
    if (existing && customKeyword) {
      const suggestions = generateKeywordSuggestions(customKeyword);
      // Filter out any that are already taken
      const available: string[] = [];
      for (const s of suggestions) {
        if (!(await Link.findOne({ keyword: s }).lean()) && !isReservedKeyword(s)) {
          available.push(s);
        }
        if (available.length >= 3) break;
      }
      return apiError("Keyword already in use", 409, available.length > 0 ? available : undefined);
    }
    while (existing) {
      keyword = generateKeyword();
      existing = await Link.findOne({ keyword }).lean();
    }

    // Auto-fetch title if not provided
    const linkTitle = title || (await fetchPageTitle(url));

    // Determine creation method
    const authHeader = request.headers.get("authorization");
    const createdVia = !user ? "form" : authHeader?.startsWith("Bearer hmd_") ? "api" : "dashboard";

    // Ownership policy:
    // - Authenticated users → owner = user.id
    // - Anonymous (unauthenticated) → owner = null ("public" link, admin-only manageable)
    const link = await Link.create({
      keyword,
      url,
      title: linkTitle,
      ip,
      clicks: 0,
      statusCode: 301,
      createdVia,
      owner: user ? user.id : null,
    });

    // Pre-warm the Redis cache — await so the link is resolvable before
    // we hand the short URL back to the caller.
    try {
      await setCachedLink(link.keyword, {
        url: link.url,
        statusCode: link.statusCode || 301,
        isPasswordProtected: false,
      });
    } catch {
      // Redis unavailable — proxy will fall back to MongoDB resolve
    }

    const base = (process.env.AUTH_URL || "https://hmd.bio").trim().replace(/\/+$/, "");
    const shortUrl = `${base}/${link.keyword}`;

    const data = {
      keyword: link.keyword,
      url: link.url,
      shortUrl,
      title: link.title,
      createdAt: link.createdAt,
    };

    const format = request.nextUrl.searchParams.get("format");
    if (format && format !== "json") {
      const cb = request.nextUrl.searchParams.get("callback");
      return formatResponse(data as unknown as Record<string, unknown>, format, 201, cb, "shortUrl");
    }

    return apiSuccess(data, 201);
  } catch (err) {
    console.error("Shorten error:", err);
    return apiError("Internal server error", 500);
  }
}
