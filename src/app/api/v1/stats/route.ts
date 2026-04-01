import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET() {
  try {
    await connectDB();

    const [totalLinks, totalClicks] = await Promise.all([
      Link.countDocuments(),
      Click.countDocuments(),
    ]);

    return apiSuccess({ totalLinks, totalClicks });
  } catch (err) {
    console.error("Stats error:", err);
    return apiError("Internal server error", 500);
  }
}
