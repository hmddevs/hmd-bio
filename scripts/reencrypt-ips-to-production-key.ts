/**
 * Re-encrypt IP ciphertext that was written under the wrong key.
 *
 * WHY THIS EXISTS. On 2026-08-07 the legacy plaintext-IP remediation
 * (remediate-link-ips.ts and remediate-click-ips.ts) was run from a developer
 * machine using the IP_ENCRYPTION_KEY in .env.local. That key is not the one
 * production uses, which was not noticed at the time because the verification
 * decrypted with the same key it had just encrypted with, and so proved nothing.
 * The result: every row that remediation touched is now readable only with the
 * local key, and production's admin decryption path returns an empty string for
 * all of it.
 *
 * No data was lost. The addresses are recoverable with the old key, which is
 * what this script does, re-encrypting each one under the correct key.
 *
 * HOW IT DECIDES. A row is only rewritten when its ciphertext decrypts under
 * OLD_IP_ENCRYPTION_KEY. Rows written by production decrypt under the current
 * key and fail under the old one, so they are left untouched. That makes the
 * script safe to run repeatedly and safe to run when the two sets are mixed,
 * which they are: the same collections hold both.
 *
 * RUN IT WHERE THE PRODUCTION KEY IS. IP_ENCRYPTION_KEY must be the production
 * value, and OLD_IP_ENCRYPTION_KEY the one from .env.local that remediation
 * used. Dry-run first, and read the counts: `already correct` should cover
 * everything production wrote, `rewritten` everything remediation touched, and
 * `undecryptable by either key` should be zero. Anything in that last bucket
 * means a third key was involved and the script must not be trusted to have
 * finished the job.
 *
 * Usage:
 *   OLD_IP_ENCRYPTION_KEY=<the .env.local value> \
 *   IP_ENCRYPTION_KEY=<the production value> \
 *   MONGODB_URI=<production> \
 *   npx tsx scripts/reencrypt-ips-to-production-key.ts --dry-run
 *
 * Then the same without --dry-run.
 */

import mongoose from "mongoose";
import { createDecipheriv, createCipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const BATCH_SIZE = 500;

function keyFrom(name: string): Buffer {
  const hex = process.env[name];
  if (!hex || hex.length !== 64) {
    throw new Error(`${name} must be a 64-character hex string (32-byte AES-256 key)`);
  }
  return Buffer.from(hex, "hex");
}

/** Returns the plaintext, or null when this key cannot open this ciphertext. */
function tryDecrypt(key: Buffer, ivHex: string, ciphertextHex: string): string | null {
  try {
    const raw = Buffer.from(ciphertextHex, "hex");
    const data = raw.subarray(0, raw.length - AUTH_TAG_LENGTH);
    const tag = raw.subarray(raw.length - AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return out.length > 0 ? out : null;
  } catch {
    // GCM authentication failure is the expected signal for "wrong key", not an
    // error worth reporting: it is how this script tells the two sets apart.
    return null;
  }
}

function encrypt(key: Buffer, plain: string): { iv: string; ciphertext: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    ciphertext: Buffer.concat([enc, cipher.getAuthTag()]).toString("hex"),
  };
}

// The models are built from a deliberately loose schema so the legacy fields can
// be read at all, which makes their inferred type incompatible with
// mongoose.Model<unknown>. Typed by inference from the factory below instead.
type LooseModel = ReturnType<typeof looseModel>;

function looseModel(name: string, collection: string) {
  return mongoose.model(name, new mongoose.Schema({}, { strict: false, collection }));
}

async function processCollection(
  model: LooseModel,
  label: string,
  oldKey: Buffer,
  newKey: Buffer,
  dryRun: boolean
) {
  const filter = { ipRaw: { $nin: [null, ""] }, ipIv: { $nin: [null, ""] } };
  const total = await model.countDocuments(filter);
  console.log(`\n${label}: ${total} document(s) with ciphertext.`);

  let rewritten = 0;
  let alreadyCorrect = 0;
  let stuck = 0;
  let ops: mongoose.AnyBulkWriteOperation[] = [];

  const flush = async () => {
    if (!ops.length || dryRun) {
      ops = [];
      return;
    }
    const batch = ops;
    ops = [];
    await model.bulkWrite(batch, { ordered: false });
  };

  const cursor = model.find(filter).select("ipRaw ipIv").cursor({ batchSize: BATCH_SIZE });

  for await (const doc of cursor) {
    const ipRaw = doc.get("ipRaw") as string;
    const ipIv = doc.get("ipIv") as string;

    // Current key first: production's own rows are the common case once this
    // has run, and checking them first makes a re-run cheap.
    if (tryDecrypt(newKey, ipIv, ipRaw) !== null) {
      alreadyCorrect++;
      continue;
    }

    const plain = tryDecrypt(oldKey, ipIv, ipRaw);
    if (plain === null) {
      stuck++;
      continue;
    }

    const { iv, ciphertext } = encrypt(newKey, plain);
    ops.push({
      updateOne: { filter: { _id: doc._id }, update: { $set: { ipIv: iv, ipRaw: ciphertext } } },
    });
    rewritten++;
    if (ops.length >= BATCH_SIZE) await flush();
  }

  await flush();

  console.log(`  already correct under the current key : ${alreadyCorrect}`);
  console.log(`  ${dryRun ? "would be rewritten" : "rewritten"}                    : ${rewritten}`);
  console.log(`  undecryptable by either key           : ${stuck}`);
  if (stuck > 0) {
    console.log("  WARNING: a third key was involved. Do not treat this run as complete.");
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const oldKey = keyFrom("OLD_IP_ENCRYPTION_KEY");
  const newKey = keyFrom("IP_ENCRYPTION_KEY");

  if (oldKey.equals(newKey)) {
    console.error("OLD_IP_ENCRYPTION_KEY and IP_ENCRYPTION_KEY are identical. Nothing to do.");
    process.exit(1);
  }

  const { MONGODB_URI } = process.env;
  if (!MONGODB_URI) {
    console.error("MONGODB_URI env var is required");
    process.exit(1);
  }

  console.log(`Connecting to MongoDB... (${dryRun ? "dry run" : "live run"})`);
  await mongoose.connect(MONGODB_URI);

  try {
    const links = looseModel("LinkReKey", "links");
    const clicks = looseModel("ClickReKey", "clicks");
    await processCollection(links, "links", oldKey, newKey, dryRun);
    await processCollection(clicks, "clicks", oldKey, newKey, dryRun);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Re-encryption failed:", err);
  process.exit(1);
});
