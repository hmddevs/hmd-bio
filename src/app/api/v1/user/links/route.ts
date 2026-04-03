import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireTurnstile } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  // User API requires Turnstile (admins exempt)
  if (user.role !== "admin") {
    const tsBlock = await requireTurnstile(null, request);
    if (tsBlock) return tsBlock;
  }

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(Number(searchParams.get("limit")) || 15, 100);
    const search = searchParams.get("search") || "";
    const sort = searchParams.get("sort") || "createdAt";
    const order = searchParams.get("order") === "asc" ? 1 : -1;

    await connectDB();

    const filter: Record<string, unknown> = { owner: user.id };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = { $regex: escaped, $options: "i" };
      filter.$or = [{ keyword: regex }, { url: regex }, { title: regex }];
    }

    const sortObj: Record<string, 1 | -1> = { [sort]: order as 1 | -1 };

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
    console.error("User links error:", err);
    return apiError("Internal server error", 500);
  }
}
