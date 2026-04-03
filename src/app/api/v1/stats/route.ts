import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  try {
    // Rate limit: 60 req/min per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = rateLimit(`stats:${ip}`, { limit: 60, windowMs: 60_000 });
    if (!rl.allowed) {
      return apiError("Rate limit exceeded. Try again later.", 429);
    }

    await connectDB();

    const [totalLinks, totalClicksAgg] = await Promise.all([
      Link.countDocuments(),
      Link.aggregate([{ $group: { _id: null, total: { $sum: "$clicks" } } }]),
    ]);

    const totalClicks = totalClicksAgg[0]?.total ?? 0;

    return apiSuccess({ totalLinks, totalClicks });
  } catch (err) {
    console.error("Stats error:", err);
    return apiError("Internal server error", 500);
  }
}
