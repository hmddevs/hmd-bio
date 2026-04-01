import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET() {
  try {
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
