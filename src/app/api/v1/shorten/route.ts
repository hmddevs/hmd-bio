import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { shortenSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import {
  generateKeyword,
  isReservedKeyword,
  isAllowedProtocol,
  fetchPageTitle,
  verifyTurnstile,
} from "@/lib/utils";
import { authenticateRequest } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const body = await request.json();
    const parsed = shortenSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { url, keyword: customKeyword, title, turnstileToken } = parsed.data;

    // Auth gate: require either a valid Turnstile token OR a valid API key
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    let authenticated = false;

    // Check API key / session first
    const user = await authenticateRequest(request);
    if (user) {
      authenticated = true;
    }

    // Check Turnstile token
    if (!authenticated && secretKey && turnstileToken) {
      const valid = await verifyTurnstile(turnstileToken, secretKey);
      if (!valid) {
        return apiError("Turnstile verification failed", 403);
      }
      authenticated = true;
    }

    // If TURNSTILE_SECRET_KEY is set (production) and neither auth method worked → reject
    if (!authenticated && secretKey) {
      return apiError("Authentication required. Provide a Turnstile token or Bearer API key.", 401);
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
    let keyword = customKeyword?.trim() || generateKeyword();

    if (isReservedKeyword(keyword)) {
      return apiError("This keyword is reserved", 400);
    }

    // Check if keyword is available (retry with random if auto-generated)
    let existing = await Link.findOne({ keyword }).lean();
    if (existing && customKeyword) {
      return apiError("Keyword already in use", 409);
    }
    while (existing) {
      keyword = generateKeyword();
      existing = await Link.findOne({ keyword }).lean();
    }

    // Auto-fetch title if not provided
    const linkTitle = title || (await fetchPageTitle(url));

    const link = await Link.create({
      keyword,
      url,
      title: linkTitle,
      ip,
      clicks: 0,
      statusCode: 301,
      ...(user ? { owner: user.id } : {}),
    });

    const base = (process.env.AUTH_URL || "https://hmd.bio").trim().replace(/\/+$/, "");
    const shortUrl = `${base}/${link.keyword}`;

    return apiSuccess(
      {
        keyword: link.keyword,
        url: link.url,
        shortUrl,
        title: link.title,
        createdAt: link.createdAt,
      },
      201
    );
  } catch (err) {
    console.error("Shorten error:", err);
    return apiError("Internal server error", 500);
  }
}
