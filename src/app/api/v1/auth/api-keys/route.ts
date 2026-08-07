import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models/User";
import { Domain } from "@/models/Domain";
import { apiKeySchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireSession } from "@/lib/api-auth";
import { hashApiKey } from "@/lib/api-keys";
import { summariseKeyScope } from "@/lib/api-key-scope";
import { PRIMARY_DOMAIN, normaliseHost } from "@/lib/domains";
import { captureError } from "@/lib/errors";
import { randomBytes } from "crypto";
import mongoose from "mongoose";

/**
 * Key management is session-only, on every method.
 *
 * This is the whole of the anti-escalation story. Rather than comparing the
 * scope a key asks for against the scope it holds, which is a comparison that
 * can be got wrong, a key simply cannot reach this endpoint: it can neither
 * mint a key nor revoke one, so it cannot widen or replace itself. Listing is
 * refused too, so a leaked key does not disclose the account's other
 * credentials.
 */
async function requireInteractiveSession(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return { ok: false as const, response: authResult.response };

  const notASession = requireSession(authResult.session);
  if (notASession) return { ok: false as const, response: notASession };

  return { ok: true as const, session: authResult.session };
}

export async function GET(request: NextRequest) {
  const gate = await requireInteractiveSession(request);
  if (!gate.ok) return gate.response;

  await connectDB();
  const user = await User.findById(gate.session.user.id).lean();
  if (!user) {
    return apiError("User not found", 404);
  }

  // Only the plaintext prefix is available post-creation; the full key is never
  // persisted. The scope summary is included so an owner can tell what a key
  // can do without having to delete it and mint a replacement.
  const keys = user.apiKeys.map((k) => ({
    _id: k._id,
    label: k.label,
    key: k.prefix + "...",
    createdAt: k.createdAt,
    ...summariseKeyScope(k),
  }));

  return apiSuccess({ keys });
}

export async function POST(request: NextRequest) {
  const gate = await requireInteractiveSession(request);
  if (!gate.ok) return gate.response;
  const { session } = gate;

  try {
    const body = await request.json();
    const parsed = apiKeySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }
    const { label, scope, domains, expiresAt } = parsed.data;

    await connectDB();

    // A key may only be confined to domains the caller actually has, so that a
    // restriction cannot be written against a hostname belonging to somebody
    // else and then quietly start applying if they ever lose it. The primary
    // domain is always allowed, since every account can create links there.
    let restrictedTo: string[] | undefined;
    if (domains && domains.length > 0) {
      const requested = Array.from(
        new Set(domains.map((d) => normaliseHost(d)).filter((d) => d !== ""))
      );
      if (requested.length === 0) {
        return apiError("No valid domain was supplied", 400);
      }

      const custom = requested.filter((d) => d !== PRIMARY_DOMAIN);
      if (custom.length > 0) {
        const owned = await Domain.find({
          hostname: { $in: custom },
          owner: session.user.id,
        })
          .select("hostname")
          .lean();
        const ownedHosts = new Set(owned.map((d) => d.hostname));
        const missing = custom.filter((d) => !ownedHosts.has(d));
        if (missing.length > 0) {
          return apiError(
            `You do not have a domain with that hostname: ${missing.join(", ")}`,
            400
          );
        }
      }

      restrictedTo = requested;
    }

    const apiKey = `hmd_${randomBytes(32).toString("hex")}`;
    const keyHash = hashApiKey(apiKey);
    const prefix = apiKey.slice(0, 8);

    // `scope` is always written for a new key. The optional fields are spread
    // so that omitting them leaves the path absent rather than null, which is
    // exactly the shape a legacy key has and what the resolver reads as
    // "unrestricted".
    const record = {
      keyHash,
      prefix,
      label,
      createdAt: new Date(),
      scope,
      ...(restrictedTo ? { domains: restrictedTo } : {}),
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    };

    await User.updateOne({ _id: session.user.id }, { $push: { apiKeys: record } });

    // The raw key is returned exactly once, here, and is never persisted or
    // logged again. The scope is echoed back so a caller storing the key can
    // record what it is good for at the same time.
    return apiSuccess(
      {
        key: apiKey,
        label,
        ...summariseKeyScope(record),
      },
      201
    );
  } catch (err) {
    captureError(err, { route: "auth/api-keys", method: "POST" });
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireInteractiveSession(request);
  if (!gate.ok) return gate.response;
  const { session } = gate;

  try {
    const { id } = await request.json();
    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      return apiError("Valid API key id required", 400);
    }

    await connectDB();

    await User.updateOne(
      { _id: session.user.id },
      { $pull: { apiKeys: { _id: id } } }
    );

    return apiSuccess({ message: "API key deleted" });
  } catch (err) {
    captureError(err, { route: "auth/api-keys", method: "DELETE" });
    return apiError("Internal server error", 500);
  }
}
