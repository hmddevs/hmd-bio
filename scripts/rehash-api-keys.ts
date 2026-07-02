/**
 * Remediate legacy plaintext apiKeys[].key entries on User documents.
 *
 * User.apiKeys previously stored the raw API key in a plaintext "key" field.
 * It now stores keyHash (SHA-256 hex digest of the raw key) plus a plaintext
 * "prefix" (first 8 chars of the raw key, used only for display — see
 * src/models/User.ts and src/app/api/v1/auth/api-keys/route.ts). Hashing the
 * existing plaintext value in place preserves the key's usability: lookups
 * compare by hash, and the hash of an unchanged raw key is stable, so keys
 * keep working after remediation.
 *
 * This script is idempotent: it only targets apiKeys subdocuments that still
 * have a legacy "key" field; once migrated that field is unset, so
 * re-running is a no-op for already-migrated entries.
 *
 * MUST be run manually against production by a human. Dry-run first.
 *
 * Usage:
 *   npx tsx scripts/rehash-api-keys.ts --dry-run
 *   npx tsx scripts/rehash-api-keys.ts
 *
 * Required env vars: MONGODB_URI
 */

import mongoose from "mongoose";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// MongoDB schema (inline, loose — legacy apiKeys[].key field is not on the
// current IApiKey interface, so we go via a permissive schema)
// ---------------------------------------------------------------------------

const ApiKeySchema = new mongoose.Schema(
  {
    key: { type: String },
    keyHash: { type: String },
    prefix: { type: String },
    label: { type: String },
    createdAt: { type: Date },
  },
  { strict: false, _id: true }
);

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    apiKeys: { type: [ApiKeySchema], default: [] },
  },
  { strict: false, collection: "users" }
);

const User = mongoose.model("UserRehash", UserSchema);

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { MONGODB_URI } = process.env;

  if (!MONGODB_URI) {
    console.error("MONGODB_URI env var is required");
    process.exit(1);
  }

  console.log(`Connecting to MongoDB... (${dryRun ? "dry run" : "live run"})`);
  await mongoose.connect(MONGODB_URI);

  try {
    const filter = { "apiKeys.key": { $exists: true, $ne: null } };
    const affectedUsers = await User.countDocuments(filter);

    let legacyKeyCount = 0;
    const usersCursor = User.find(filter).cursor();
    for await (const user of usersCursor) {
      const apiKeys = (user.get("apiKeys") as Array<Record<string, unknown>>) || [];
      legacyKeyCount += apiKeys.filter((k) => typeof k.key === "string" && k.key).length;
    }

    console.log(
      `Found ${affectedUsers} user document(s) with ${legacyKeyCount} legacy plaintext apiKeys entr(y/ies).`
    );

    if (affectedUsers === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    if (dryRun) {
      const sample = await User.find(filter).limit(5).select("username").lean();
      console.log(
        `Dry run: would rehash ${legacyKeyCount} key(s) across ${affectedUsers} user(s) and remove the legacy field. Sample usernames:`,
        sample.map((s) => s.username)
      );
      return;
    }

    let migratedUsers = 0;
    let migratedKeys = 0;
    let failed = 0;
    const cursor = User.find(filter).cursor();

    for await (const user of cursor) {
      const apiKeys = (user.get("apiKeys") as Array<Record<string, unknown>>) || [];
      let changed = false;

      const nextApiKeys = apiKeys.map((entry) => {
        const rawKey = entry.key;
        if (typeof rawKey !== "string" || !rawKey) {
          return entry;
        }
        changed = true;
        migratedKeys++;
        const { key, ...rest } = entry;
        void key;
        return {
          ...rest,
          keyHash: hashApiKey(rawKey),
          prefix: rest.prefix || rawKey.slice(0, 8),
        };
      });

      if (!changed) continue;

      try {
        await User.updateOne({ _id: user._id }, { $set: { apiKeys: nextApiKeys } });
        migratedUsers++;
      } catch (err) {
        failed++;
        console.error(`Failed to migrate user ${user._id}:`, (err as Error).message);
      }
    }

    console.log(
      `Done. Migrated ${migratedKeys} key(s) across ${migratedUsers} user document(s), ${failed} failure(s).`
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Remediation failed:", err);
  process.exit(1);
});
