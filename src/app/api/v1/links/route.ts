import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { linksQuerySchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { buildShortUrl } from "@/lib/domains";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-list:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = linksQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { domain, page, limit, search, sort, order, dateFrom, dateTo, minClicks, maxClicks } =
      parsed.data;

    await connectDB();

    // Build filter
    const filter: Record<string, unknown> = {};

    if (session.user.role !== "admin") {
      filter.owner = session.user.id;
    }

    // Note the asymmetry with /api/v1/links/[keyword]: there, an absent
    // `domain` defaults to the primary domain, because that route addresses one
    // specific record and guessing which domain it meant would be wrong. Here,
    // an absent `domain` lists across every domain the caller owns, which is
    // what a dashboard needs. Ownership is already enforced by `filter.owner`,
    // so the wider default leaks nothing.
    if (domain) {
      filter.domain = domain;
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = { $regex: escaped, $options: "i" };
      filter.$or = [
        { keyword: regex },
        { url: regex },
        { title: regex },
      ];
    }

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) (filter.createdAt as Record<string, unknown>).$gte = new Date(dateFrom);
      if (dateTo) (filter.createdAt as Record<string, unknown>).$lte = new Date(dateTo);
    }

    if (minClicks !== undefined || maxClicks !== undefined) {
      filter.clicks = {};
      if (minClicks !== undefined) (filter.clicks as Record<string, unknown>).$gte = minClicks;
      if (maxClicks !== undefined) (filter.clicks as Record<string, unknown>).$lte = maxClicks;
    }

    const sortObj: Record<string, 1 | -1> = { [sort]: order === "asc" ? 1 : -1 };

    const [links, total] = await Promise.all([
      Link.find(filter)
        .select("-password -ipRaw -ipIv")
        .sort(sortObj)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Link.countDocuments(filter),
    ]);

    return apiSuccess({
      // `domain` is already on each document; `shortUrl` is added so a client
      // never has to reconstruct the origin itself.
      links: links.map((link) => ({
        ...link,
        shortUrl: buildShortUrl(link.domain, link.keyword),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    captureError(err, { route: "api/v1/links" });
    return apiError("Internal server error", 500);
  }
}
