import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const page = Number(request.nextUrl.searchParams.get("page")) || 1;
    const limit = Math.min(
      Number(request.nextUrl.searchParams.get("limit")) || 15,
      100
    );

    await connectDB();

    const filter = { owner: user.id };

    const [links, total] = await Promise.all([
      Link.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("keyword url title clicks createdAt")
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
