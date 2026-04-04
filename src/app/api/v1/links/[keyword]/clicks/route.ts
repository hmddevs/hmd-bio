import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { authenticateRequest, requireAdmin } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  try {
    const { keyword } = await params;
    const page = Number(request.nextUrl.searchParams.get("page")) || 1;
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 50, 100);

    await connectDB();

    const link = await Link.findOne({ keyword }).lean();
    if (!link) {
      return apiError("Link not found", 404);
    }

    const [clicks, total] = await Promise.all([
      Click.find({ keyword })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Click.countDocuments({ keyword }),
    ]);

    return apiSuccess({
      clicks,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("Click log error:", err);
    return apiError("Internal server error", 500);
  }
}
