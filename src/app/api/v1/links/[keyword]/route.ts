import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Click } from "@/models/Click";
import { editLinkSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireOwnership } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { isReservedKeyword } from "@/lib/utils";
import bcrypt from "bcryptjs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-keyword:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  const { keyword } = await params;
  await connectDB();

  const link = await Link.findOne({ keyword }).select("-password -ipRaw -ipIv").lean();
  if (!link) {
    return apiError("Link not found", 404);
  }

  const forbidden = requireOwnership(link, session);
  if (forbidden) return forbidden;

  return apiSuccess(link);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-keyword:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const { keyword } = await params;
    const body = await request.json();
    const parsed = editLinkSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    await connectDB();

    const existing = await Link.findOne({ keyword });
    if (!existing) {
      return apiError("Link not found", 404);
    }

    const forbidden = requireOwnership(existing, session);
    if (forbidden) return forbidden;

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
      // Update click references
      await Click.updateMany({ keyword }, { keyword: newKeyword });
    }

    const updated = await Link.findOneAndUpdate({ keyword }, { $set: updates }, { new: true })
      .select("-password -ipRaw -ipIv")
      .lean();

    return apiSuccess(updated);
  } catch (err) {
    captureError(err, { route: "links/[keyword]", method: "PUT" });
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-keyword:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  const { keyword } = await params;
  await connectDB();

  const existing = await Link.findOne({ keyword });
  if (!existing) {
    return apiError("Link not found", 404);
  }

  const forbidden = requireOwnership(existing, session);
  if (forbidden) return forbidden;

  await Link.deleteOne({ keyword });

  // Also remove click logs
  await Click.deleteMany({ keyword });

  return apiSuccess({ deleted: keyword });
}
