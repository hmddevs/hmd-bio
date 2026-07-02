import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ipHash = hashIP(rawIp);
    const rl = await rateLimit(`stats:${ipHash}`, { tier: "public" });
    if (!rl.allowed) {
      return apiError("Too many requests", 429);
    }

    await connectDB();

    const [totalLinks, totalClicksAgg] = await Promise.all([
      Link.countDocuments(),
      Link.aggregate([{ $group: { _id: null, total: { $sum: "$clicks" } } }]),
    ]);

    const totalClicks = totalClicksAgg[0]?.total ?? 0;

    return apiSuccess({ totalLinks, totalClicks });
  } catch (err) {
    captureError(err, { route: "stats" });
    return apiError("Internal server error", 500);
  }
}
