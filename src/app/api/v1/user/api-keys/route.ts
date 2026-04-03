import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { apiKeySchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireTurnstile } from "@/lib/auth";
import { randomBytes } from "crypto";

export async function GET(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  // User API requires Turnstile (admins exempt)
  if (user.role !== "admin") {
    const tsBlock = await requireTurnstile(null, request);
    if (tsBlock) return tsBlock;
  }

  await connectDB();
  const dbUser = await User.findById(user.id).lean();
  if (!dbUser) {
    return apiError("User not found", 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keys = dbUser.apiKeys.map((k: any) => ({
    _id: k._id,
    label: k.label,
    key: k.key.slice(0, 8) + "..." + k.key.slice(-4),
    createdAt: k.createdAt,
  }));

  return apiSuccess({ keys });
}

export async function POST(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  // User API requires Turnstile (admins exempt)
  if (user.role !== "admin") {
    const tsBlock = await requireTurnstile(null, request);
    if (tsBlock) return tsBlock;
  }

  try {
    const body = await request.json();
    const parsed = apiKeySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    await connectDB();

    // Limit to 5 API keys per user
    const dbUser = await User.findById(user.id);
    if (!dbUser) return apiError("User not found", 404);
    if (dbUser.apiKeys.length >= 5) {
      return apiError("Maximum 5 API keys allowed", 400);
    }

    const apiKey = `hmd_${randomBytes(32).toString("hex")}`;

    await User.updateOne(
      { _id: user.id },
      {
        $push: {
          apiKeys: {
            key: apiKey,
            label: parsed.data.label,
            createdAt: new Date(),
          },
        },
      }
    );

    return apiSuccess({ key: apiKey, label: parsed.data.label }, 201);
  } catch (err) {
    console.error("Create API key error:", err);
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  // User API requires Turnstile (admins exempt)
  if (user.role !== "admin") {
    const tsBlock = await requireTurnstile(null, request);
    if (tsBlock) return tsBlock;
  }

  try {
    const { id } = await request.json();
    if (!id) {
      return apiError("API key id required", 400);
    }

    await connectDB();

    await User.updateOne(
      { _id: user.id },
      { $pull: { apiKeys: { _id: id } } }
    );

    return apiSuccess({ message: "API key deleted" });
  } catch (err) {
    console.error("Delete API key error:", err);
    return apiError("Internal server error", 500);
  }
}
