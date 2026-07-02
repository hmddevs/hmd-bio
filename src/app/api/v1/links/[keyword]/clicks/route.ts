import { NextRequest } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireOwnership } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";

const clicksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`clicks-list:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const { keyword } = await params;
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = clicksQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }
    const { page, limit } = parsed.data;

    await connectDB();

    const link = await Link.findOne({ keyword }).lean();
    if (!link) {
      return apiError("Link not found", 404);
    }

    const forbidden = requireOwnership(link, session);
    if (forbidden) return forbidden;

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
    captureError(err, { route: "v1/links/[keyword]/clicks" });
    return apiError("Internal server error", 500);
  }
}
