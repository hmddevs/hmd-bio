import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { editLinkSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api/api-response";
import { authenticateRequest } from "@/lib/auth";
import { isReservedKeyword } from "@/lib/utils";
import { invalidateCachedLink } from "@/lib/integrations/cache";
import bcrypt from "bcryptjs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);

  const { keyword } = await params;
  await connectDB();

  const link = await Link.findOne({ keyword }).select("-password").lean();
  if (!link) return apiError("Link not found", 404);

  if (!link.owner || link.owner.toString() !== user.id) {
    return apiError("Forbidden", 403);
  }

  return apiSuccess(link);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const user = await authenticateRequest(request);
  if (!user) return apiError("Unauthorized", 401);

  try {
    const { keyword } = await params;
    const body = await request.json();
    const parsed = editLinkSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    await connectDB();

    const existing = await Link.findOne({ keyword });
    if (!existing) return apiError("Link not found", 404);

    if (!existing.owner || existing.owner.toString() !== user.id) {
      return apiError("Forbidden", 403);
    }

    const updates: Record<string, unknown> = {};

    if (parsed.data.url) updates.url = parsed.data.url;
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.statusCode) updates.statusCode = Number(parsed.data.statusCode);
    if (parsed.data.removePassword) {
      updates.isPasswordProtected = false;
      updates.password = null;
    } else {
      if (parsed.data.isPasswordProtected !== undefined) {
        updates.isPasswordProtected = parsed.data.isPasswordProtected;
      }
      if (parsed.data.password) {
        updates.password = await bcrypt.hash(parsed.data.password, 10);
        updates.isPasswordProtected = true;
      }
    }
    if (parsed.data.expiresAt !== undefined) {
      updates.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    }
    if (parsed.data.ogTitle !== undefined) updates.ogTitle = parsed.data.ogTitle;
    if (parsed.data.ogDescription !== undefined) updates.ogDescription = parsed.data.ogDescription;
    if (parsed.data.ogImage !== undefined) updates.ogImage = parsed.data.ogImage;

    // Handle keyword change
    if (parsed.data.keyword && parsed.data.keyword !== keyword) {
      const newKeyword = parsed.data.keyword;
      if (isReservedKeyword(newKeyword)) {
        return apiError("This keyword is reserved", 400);
      }
      const conflict = await Link.findOne({ keyword: newKeyword });
      if (conflict) {
        return apiError("New keyword already in use", 409);
      }
      updates.keyword = newKeyword;
      await Click.updateMany({ keyword }, { keyword: newKeyword });
    }

    const updated = await Link.findOneAndUpdate({ keyword }, { $set: updates }, { new: true })
      .select("-password")
      .lean();

    invalidateCachedLink(keyword).catch(() => {});
    if (updates.keyword && updates.keyword !== keyword) {
      invalidateCachedLink(updates.keyword as string).catch(() => {});
    }

    return apiSuccess(updated);
  } catch (err) {
    console.error("Edit link error:", err);
    return apiError("Internal server error", 500);
  }
}

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

  if (!link.owner || link.owner.toString() !== user.id) {
    return apiError("Forbidden", 403);
  }

  await Click.deleteMany({ keyword });
  await link.deleteOne();

  invalidateCachedLink(keyword).catch(() => {});

  return apiSuccess({ deleted: keyword });
}
