import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { linksQuerySchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = linksQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { page, limit, search, sort, order, dateFrom, dateTo, minClicks, maxClicks } =
      parsed.data;

    await connectDB();

    // Build filter
    const filter: Record<string, unknown> = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = { $regex: escaped, $options: "i" };
      filter.$or = [
        { keyword: regex },
        { url: regex },
        { title: regex },
        { ip: regex },
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
        .sort(sortObj)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Link.countDocuments(filter),
    ]);

    return apiSuccess({
      links,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Links list error:", err);
    return apiError("Internal server error", 500);
  }
}
