import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link, LIVE_LINK_FILTER } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { domainQuerySchema } from "@/lib/validations";
import { PRIMARY_DOMAIN, buildShortUrl } from "@/lib/domains";

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return apiError("Missing keyword parameter", 400);
  }

  // Addresses one record, so an absent `domain` means the primary domain.
  const rawDomain = request.nextUrl.searchParams.get("domain");
  const parsedDomain = domainQuerySchema.safeParse(
    rawDomain === null ? {} : { domain: rawDomain }
  );
  if (!parsedDomain.success) {
    return apiError("Invalid domain", 400);
  }
  const domain = parsedDomain.data.domain ?? PRIMARY_DOMAIN;

  const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const ipHash = hashIP(rawIp);
  const rl = await rateLimit(`expand:${ipHash}`, { tier: "public" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  await connectDB();
  // Unauthenticated, so a detached link must not be readable here either:
  // otherwise the next owner of a hostname could enumerate the previous
  // owner's destinations.
  const link = await Link.findOne({ domain, keyword, ...LIVE_LINK_FILTER }).lean();
  if (!link) {
    return apiError("Short URL not found", 404);
  }

  return apiSuccess({
    keyword: link.keyword,
    domain: link.domain,
    shortUrl: buildShortUrl(link.domain, link.keyword),
    url: link.url,
    title: link.title,
    createdAt: link.createdAt,
  });
}
