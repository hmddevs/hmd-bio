import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("keyword");
  if (!keyword) {
    return apiError("Missing keyword parameter", 400);
  }

  await connectDB();
  const link = await Link.findOne({ keyword }).lean();
  if (!link) {
    return apiError("Short URL not found", 404);
  }

  return apiSuccess({
    keyword: link.keyword,
    url: link.url,
    title: link.title,
    createdAt: link.createdAt,
  });
}
