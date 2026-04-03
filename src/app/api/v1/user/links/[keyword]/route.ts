import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest } from "@/lib/auth";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);

  const { keyword } = await params;
  await connectDB();

  const link = await Link.findOne({ keyword });
  if (!link) return apiError("Link not found", 404);

  // Users can only delete their own links
  if (!link.owner || link.owner.toString() !== user.id) {
    return apiError("Forbidden", 403);
  }

  await Click.deleteMany({ keyword });
  await link.deleteOne();

  return apiSuccess({ deleted: keyword });
}
