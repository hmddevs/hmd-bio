/**
 * Remediate legacy plaintext "ip" field on Link documents.
 *
 * Link previously stored the creator's IP address as a plain-text "ip" field.
 * That field has been replaced by encrypted ipRaw/ipIv (see src/models/Link.ts
 * and src/lib/ip.ts — encryptIP()). Any document still holding the old raw
 * "ip" field needs that value migrated into ipRaw/ipIv and the old field
 * removed.
 *
 * This script is idempotent: it only targets documents where "ip" still
 * exists as a field, and once migrated that field is unset, so re-running is
 * a no-op for already-migrated documents.
 *
 * MUST be run manually against production by a human. Dry-run first.
 *
 * Usage:
 *   npx tsx scripts/remediate-link-ips.ts --dry-run
 *   npx tsx scripts/remediate-link-ips.ts
 *
 * Required env vars: MONGODB_URI, IP_ENCRYPTION_KEY
 */

import mongoose from "mongoose";
import { encryptIP } from "../src/lib/ip";

// ---------------------------------------------------------------------------
// MongoDB schema (inline, loose — legacy "ip" field is not on the current
// ILink interface, so we go via a permissive schema to read/unset it safely)
// ---------------------------------------------------------------------------

const LinkSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true },
    ip: { type: String },
    ipRaw: { type: String, default: "" },
    ipIv: { type: String, default: "" },
  },
  { strict: false, collection: "links" }
);

const Link = mongoose.model("LinkRemediation", LinkSchema);

const BATCH_SIZE = 500;

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
    const filter = { ip: { $exists: true, $ne: null } };
    const total = await Link.countDocuments(filter);
    console.log(`Found ${total} link document(s) with a legacy plaintext "ip" field.`);

    if (total === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    if (dryRun) {
      const sample = await Link.find(filter).limit(5).select("keyword").lean();
      console.log(
        `Dry run: would migrate ${total} document(s) and remove the legacy field. Sample keywords:`,
        sample.map((s) => s.keyword)
      );
      return;
    }

    let migrated = 0;
    let failed = 0;
    let cursor = Link.find(filter).cursor({ batchSize: BATCH_SIZE });

    for await (const doc of cursor) {
      const rawIp = (doc.get("ip") as string) || "";
      try {
        if (rawIp) {
          const { iv, ciphertext } = encryptIP(rawIp);
          await Link.updateOne(
            { _id: doc._id },
            { $set: { ipIv: iv, ipRaw: ciphertext }, $unset: { ip: "" } }
          );
        } else {
          // Empty/blank legacy field — nothing to encrypt, just drop it.
          await Link.updateOne({ _id: doc._id }, { $unset: { ip: "" } });
        }
        migrated++;
      } catch (err) {
        failed++;
        console.error(`Failed to migrate link ${doc._id}:`, (err as Error).message);
      }

      if ((migrated + failed) % BATCH_SIZE === 0) {
        console.log(`Progress: ${migrated + failed}/${total}`);
      }
    }

    console.log(`Done. Migrated ${migrated} document(s), ${failed} failure(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Remediation failed:", err);
  process.exit(1);
});
