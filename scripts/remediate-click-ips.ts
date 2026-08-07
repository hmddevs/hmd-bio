/**
 * Remediate legacy plaintext "ip" field on Click documents.
 *
 * The companion to remediate-link-ips.ts, for the collection that holds the
 * bulk of the exposure. Click previously stored the visitor's IP address as a
 * plain-text "ip" field, written by the legacy YOURLS platform and carried over
 * by scripts/backfill-clicks.ts. That field has been replaced by encrypted
 * ipRaw/ipIv (see src/models/Click.ts and encryptIP() in src/lib/ip.ts). Any
 * document still holding the old raw "ip" needs that value migrated into
 * ipRaw/ipIv and the old field removed.
 *
 * Idempotent: it only targets documents where "ip" still exists, and that field
 * is unset once migrated, so a re-run is a no-op for migrated documents.
 *
 * Unlike the link script this writes via bulkWrite rather than one updateOne
 * per document. The click collection is roughly three hundred times larger, and
 * a round trip per document takes long enough that a mid-run interruption
 * becomes the likely outcome rather than an edge case. Each document still gets
 * its own IV, since reusing an IV across records under one key would let an
 * observer tell which visitors shared an address.
 *
 * MUST be run manually against production by a human. Dry-run first.
 *
 * Usage:
 *   npx tsx scripts/remediate-click-ips.ts --dry-run
 *   npx tsx scripts/remediate-click-ips.ts
 *
 * Required env vars: MONGODB_URI, IP_ENCRYPTION_KEY
 */

import mongoose from "mongoose";
import { encryptIP } from "../src/lib/ip";

// Inline and permissive, matching remediate-link-ips.ts: the legacy "ip" field
// is deliberately absent from the current IClick interface, so a strict schema
// could not read it in order to remove it.
const ClickSchema = new mongoose.Schema(
  {
    keyword: { type: String },
    ip: { type: String },
    ipRaw: { type: String, default: "" },
    ipIv: { type: String, default: "" },
  },
  { strict: false, collection: "clicks" }
);

const Click = mongoose.model("ClickRemediation", ClickSchema);

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
    const total = await Click.countDocuments(filter);
    console.log(`Found ${total} click document(s) with a legacy plaintext "ip" field.`);

    if (total === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    if (dryRun) {
      const withValue = await Click.countDocuments({ ip: { $nin: [null, ""] } });
      console.log(
        `Dry run: would encrypt ${withValue} value(s) into ipRaw/ipIv and remove the ` +
          `legacy field from all ${total} document(s). No write performed.`
      );
      return;
    }

    let migrated = 0;
    let failed = 0;
    let ops: mongoose.AnyBulkWriteOperation[] = [];

    const flush = async () => {
      if (ops.length === 0) return;
      const batch = ops;
      ops = [];
      try {
        const res = await Click.bulkWrite(batch, { ordered: false });
        migrated += res.modifiedCount;
      } catch (err) {
        // An unordered bulkWrite applies what it can, so a partial failure still
        // makes progress and the next run picks up whatever was missed.
        failed += batch.length;
        console.error(`Batch failed: ${(err as Error).message}`);
      }
      console.log(`Progress: ${migrated + failed}/${total}`);
    };

    const cursor = Click.find(filter).select("ip").cursor({ batchSize: BATCH_SIZE });

    for await (const doc of cursor) {
      const rawIp = (doc.get("ip") as string) || "";
      if (rawIp) {
        const { iv, ciphertext } = encryptIP(rawIp);
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { ipIv: iv, ipRaw: ciphertext }, $unset: { ip: "" } },
          },
        });
      } else {
        // Empty legacy field: nothing to encrypt, just drop it.
        ops.push({
          updateOne: { filter: { _id: doc._id }, update: { $unset: { ip: "" } } },
        });
      }

      if (ops.length >= BATCH_SIZE) await flush();
    }

    await flush();

    console.log(`Done. Migrated ${migrated} document(s), ${failed} failure(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Remediation failed:", err);
  process.exit(1);
});
