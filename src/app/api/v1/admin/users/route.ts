import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimit(`admin-users:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const page = Number(request.nextUrl.searchParams.get("page")) || 1;
    const limit = Math.min(
      Number(request.nextUrl.searchParams.get("limit")) || 20,
      100
    );
    const search = request.nextUrl.searchParams.get("search") || "";
    const status = request.nextUrl.searchParams.get("status") || "";

    await connectDB();

    const filter: Record<string, unknown> = {};
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = { $regex: escaped, $options: "i" };
      filter.$or = [{ username: regex }, { email: regex }];
    }
    if (status && ["pending", "approved", "disabled"].includes(status)) {
      filter.status = status;
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("username email role isVerified status createdAt")
        .lean(),
      User.countDocuments(filter),
    ]);

    // Attach link counts per user
    const userIds = users.map((u) => u._id);
    const linkCounts = await Link.aggregate([
      { $match: { owner: { $in: userIds } } },
      { $group: { _id: "$owner", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(
      linkCounts.map((lc) => [lc._id.toString(), lc.count])
    );

    const enriched = users.map((u) => ({
      ...u,
      linkCount: countMap.get(u._id.toString()) || 0,
    }));

    return apiSuccess({
      users: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    captureError(err, { route: "admin/users:GET" });
    return apiError("Internal server error", 500);
  }
}
