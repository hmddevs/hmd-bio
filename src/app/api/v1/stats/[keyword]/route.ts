import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  try {
    const { keyword } = await params;
    await connectDB();

    const link = await Link.findOne({ keyword }).lean();
    if (!link) {
      return apiError("Short URL not found", 404);
    }

    // Aggregated stats
    const [referrers, countries, timeline] = await Promise.all([
      Click.aggregate([
        { $match: { keyword } },
        { $group: { _id: "$referrer", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      Click.aggregate([
        { $match: { keyword } },
        { $group: { _id: "$countryCode", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Click.aggregate([
        { $match: { keyword } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return apiSuccess({
      keyword: link.keyword,
      url: link.url,
      title: link.title,
      clicks: link.clicks,
      createdAt: link.createdAt,
      referrers: referrers.map((r) => ({ referrer: r._id || "Direct", count: r.count })),
      countries: countries.map((c) => ({ code: c._id || "Unknown", count: c.count })),
      timeline: timeline.map((t) => ({ date: t._id, count: t.count })),
    });
  } catch (err) {
    console.error("Keyword stats error:", err);
    return apiError("Internal server error", 500);
  }
}
