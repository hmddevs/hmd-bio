import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  try {
    await connectDB();

    const links = await Link.find({})
      .sort({ createdAt: -1 })
      .lean();

    // Format as CSV
    const header = "keyword,url,title,clicks,statusCode,createdAt";
    const rows = links.map(
      (l) =>
        `"${l.keyword}","${l.url.replace(/"/g, '""')}","${(l.title || "").replace(/"/g, '""')}",${l.clicks},${l.statusCode},${l.createdAt.toISOString()}`
    );
    const csv = [header, ...rows].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="hmd-bio-links-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return apiError("Internal server error", 500);
  }
}
