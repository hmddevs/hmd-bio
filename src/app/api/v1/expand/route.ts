import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { rateLimit } from "@/lib/api/rate-limit";
import { authenticateRequest } from "@/lib/auth";
import { formatResponse } from "@/lib/api/format-response";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized — API key required", 401);
  }

  // Rate limit: 60 req/min per IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = rateLimit(`expand:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return apiError("Rate limit exceeded. Try again later.", 429);
  }

  const keyword = request.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return apiError("Missing keyword parameter", 400);
  }

  await connectDB();
  const link = await Link.findOne({ keyword }).lean();
  if (!link) {
    return apiError("Short URL not found", 404);
  }

  const data = {
    keyword: link.keyword,
    url: link.url,
    title: link.title,
    createdAt: link.createdAt,
  };

  const format = request.nextUrl.searchParams.get("format");
  if (format && format !== "json") {
    const cb = request.nextUrl.searchParams.get("callback");
    return formatResponse(data as unknown as Record<string, unknown>, format, 200, cb, "url");
  }

  return apiSuccess(data);
}
