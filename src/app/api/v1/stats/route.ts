import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { PRIMARY_DOMAIN } from "@/lib/domains";

export async function GET(request: NextRequest) {
  try {
    const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ipHash = hashIP(rawIp);
    const rl = await rateLimit(`stats:${ipHash}`, { tier: "public" });
    if (!rl.allowed) {
      return apiError("Too many requests", 429);
    }

    await connectDB();

    // Public, unauthenticated counters, so they cover the platform's own domain
    // only. An unscoped count would publish every tenant's link and click
    // volume on a custom domain to anyone who asks.
    const [totalLinks, totalClicksAgg] = await Promise.all([
      Link.countDocuments({ domain: PRIMARY_DOMAIN }),
      Link.aggregate([
        { $match: { domain: PRIMARY_DOMAIN } },
        { $group: { _id: null, total: { $sum: "$clicks" } } },
      ]),
    ]);

    const totalClicks = totalClicksAgg[0]?.total ?? 0;

    return apiSuccess({ totalLinks, totalClicks });
  } catch (err) {
    captureError(err, { route: "stats" });
    return apiError("Internal server error", 500);
  }
}
