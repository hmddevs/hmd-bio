import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Domain, type DomainStatus } from "@/models/Domain";
import { User } from "@/models/User";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";

const VALID_STATUSES: DomainStatus[] = [
  "pending_dns",
  "verifying",
  "provisioning",
  "active",
  "failed",
  "suspended",
];

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimit(`admin-domains:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const page = Number(request.nextUrl.searchParams.get("page")) || 1;
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 20, 100);
    const search = request.nextUrl.searchParams.get("search") || "";
    const status = request.nextUrl.searchParams.get("status") || "";

    await connectDB();

    const filter: Record<string, unknown> = {};
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.hostname = { $regex: escaped, $options: "i" };
    }
    if (status && VALID_STATUSES.includes(status as DomainStatus)) {
      filter.status = status;
    }

    const [domains, total] = await Promise.all([
      Domain.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        // Explicit include list: verificationToken must never leave this route.
        .select("hostname owner status linkCount verifiedAt createdAt failureReason")
        .lean(),
      Domain.countDocuments(filter),
    ]);

    const ownerIds = domains.map((d) => d.owner);
    const owners = await User.find({ _id: { $in: ownerIds } })
      .select("username email")
      .lean();
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o]));

    const enriched = domains.map((d) => {
      const owner = ownerMap.get(d.owner.toString());
      return {
        hostname: d.hostname,
        status: d.status,
        linkCount: d.linkCount,
        verifiedAt: d.verifiedAt ?? null,
        createdAt: d.createdAt,
        failureReason: d.failureReason ?? null,
        owner: owner ? { username: owner.username, email: owner.email } : null,
      };
    });

    return apiSuccess({
      domains: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    captureError(err, { route: "admin/domains:GET" });
    return apiError("Internal server error", 500);
  }
}
