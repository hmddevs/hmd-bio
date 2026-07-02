import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { shortenSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireTurnstile } from "@/lib/auth";
import { hashIP, encryptIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import {
  generateKeyword,
  isReservedKeyword,
  isAllowedProtocol,
  fetchPageTitle,
} from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = shortenSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { url, keyword: customKeyword, title, turnstileToken } = parsed.data;

    // Cloudflare Turnstile verification: rejects a missing/invalid token
    // whenever TURNSTILE_SECRET_KEY is configured, skips only in dev mode.
    const turnstileRejection = await requireTurnstile(turnstileToken, request);
    if (turnstileRejection) return turnstileRejection;

    // Protocol check
    if (!isAllowedProtocol(url)) {
      return apiError("URL protocol not allowed", 400);
    }

    const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ipHash = hashIP(rawIp);

    const rl = await rateLimit(`shorten:${ipHash}`, { tier: "public" });
    if (!rl.allowed) {
      return apiError("Too many requests", 429);
    }

    const user = await authenticateRequest(request);

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

    const { iv: ipIv, ciphertext: ipRaw } = encryptIP(rawIp);

    const link = await Link.create({
      keyword,
      url,
      title: linkTitle,
      ipRaw,
      ipIv,
      clicks: 0,
      statusCode: 301,
      owner: user?.id ?? null,
      createdVia: "api",
    });

    const shortUrl = `${process.env.AUTH_URL || "https://hmd.bio"}/${link.keyword}`;

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
    captureError(err, { route: "api/v1/shorten" });
    return apiError("Internal server error", 500);
  }
}
