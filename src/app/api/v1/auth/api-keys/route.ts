import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { apiKeySchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { randomBytes } from "crypto";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  await connectDB();
  const user = await User.findOne({ username: session.user.name }).lean();
  if (!user) {
    return apiError("User not found", 404);
  }

  // Return keys with masked values
  const keys = user.apiKeys.map((k) => ({
    label: k.label,
    key: k.key.slice(0, 8) + "..." + k.key.slice(-4),
    createdAt: k.createdAt,
  }));

  return apiSuccess({ keys });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const body = await request.json();
    const parsed = apiKeySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    await connectDB();

    const apiKey = `hmd_${randomBytes(32).toString("hex")}`;

    await User.updateOne(
      { username: session.user.name },
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
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const { key } = await request.json();
    if (!key) {
      return apiError("API key required", 400);
    }

    await connectDB();

    await User.updateOne(
      { username: session.user.name },
      { $pull: { apiKeys: { key } } }
    );

    return apiSuccess({ message: "API key deleted" });
  } catch (err) {
    console.error("Delete API key error:", err);
    return apiError("Internal server error", 500);
  }
}
