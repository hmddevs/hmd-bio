import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return apiError("Missing keyword parameter", 400);
  }

  const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const ipHash = hashIP(rawIp);
  const rl = await rateLimit(`expand:${ipHash}`, { tier: "public" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  await connectDB();
  const link = await Link.findOne({ keyword }).lean();
  if (!link) {
    return apiError("Short URL not found", 404);
  }

  return apiSuccess({
    keyword: link.keyword,
    url: link.url,
    title: link.title,
    createdAt: link.createdAt,
  });
}
