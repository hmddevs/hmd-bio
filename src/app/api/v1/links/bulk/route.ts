import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { bulkImportSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireAdmin } from "@/lib/auth";
import { generateKeyword, isReservedKeyword, isAllowedProtocol } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }
  const forbidden = requireAdmin(user);
  if (forbidden) return forbidden;

  try {
    const body = await request.json();
    const parsed = bulkImportSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Invalid import data: " + parsed.error.issues[0].message, 400);
    }

    await connectDB();

    const results: { keyword: string; url: string; status: "created" | "skipped"; reason?: string }[] = [];

    for (const item of parsed.data) {
      if (!isAllowedProtocol(item.url)) {
        results.push({ keyword: item.keyword || "", url: item.url, status: "skipped", reason: "Protocol not allowed" });
        continue;
      }

      let keyword = item.keyword?.trim() || generateKeyword();
      if (isReservedKeyword(keyword)) {
        results.push({ keyword, url: item.url, status: "skipped", reason: "Reserved keyword" });
        continue;
      }

      const existing = await Link.findOne({ keyword }).lean();
      if (existing) {
        if (item.keyword) {
          results.push({ keyword, url: item.url, status: "skipped", reason: "Keyword taken" });
          continue;
        }
        keyword = generateKeyword();
      }

      await Link.create({
        keyword,
        url: item.url,
        title: item.title || "",
        ip: "",
        clicks: 0,
        statusCode: 301,
      });

      results.push({ keyword, url: item.url, status: "created" });
    }

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return apiSuccess({ results, summary: { created, skipped, total: results.length } }, 201);
  } catch (err) {
    console.error("Bulk import error:", err);
    return apiError("Internal server error", 500);
  }
}
