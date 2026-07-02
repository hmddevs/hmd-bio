import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { apiKeySchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hashApiKey } from "@/lib/api-keys";
import { captureError } from "@/lib/errors";
import { randomBytes } from "crypto";
import mongoose from "mongoose";

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

  // Only the plaintext prefix is available post-creation; the full key is never persisted.
  const keys = user.apiKeys.map((k) => ({
    _id: k._id,
    label: k.label,
    key: k.prefix + "...",
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
    const keyHash = hashApiKey(apiKey);
    const prefix = apiKey.slice(0, 8);

    await User.updateOne(
      { username: session.user.name },
      {
        $push: {
          apiKeys: {
            keyHash,
            prefix,
            label: parsed.data.label,
            createdAt: new Date(),
          },
        },
      }
    );

    // The raw key is returned exactly once, here, and is never persisted or logged again.
    return apiSuccess({ key: apiKey, label: parsed.data.label }, 201);
  } catch (err) {
    captureError(err, { route: "auth/api-keys", method: "POST" });
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const { id } = await request.json();
    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      return apiError("Valid API key id required", 400);
    }

    await connectDB();

    await User.updateOne(
      { username: session.user.name },
      { $pull: { apiKeys: { _id: id } } }
    );

    return apiSuccess({ message: "API key deleted" });
  } catch (err) {
    captureError(err, { route: "auth/api-keys", method: "DELETE" });
    return apiError("Internal server error", 500);
  }
}
