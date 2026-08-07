/**
 * Migration: index `apiKeys.keyHash` on the `users` collection.
 *
 * API-key authentication resolves a Bearer token by hashing it and looking the
 * user up by that hash (`src/lib/auth.ts`). That lookup had no index, so every
 * miss was a collection scan. It became reachable by an unauthenticated caller
 * when `/api/v1/shorten` started resolving identity before running Turnstile,
 * which turns an unindexed scan into something an anonymous request can trigger.
 *
 * The index is non-unique on purpose. A unique index would be wrong: it is a
 * multikey index over an array of subdocuments, and two users each holding zero
 * keys must not collide. Uniqueness of key material comes from the 32 random
 * bytes behind the hash, not from the database.
 *
 * Additive and non-destructive: it creates one index and drops nothing. Safe to
 * re-run, `createIndex` is a no-op when the index already exists with the same
 * specification.
 *
 * `autoIndex` is disabled in src/lib/db.ts, so the declaration in
 * src/models/User.ts does not create this on its own. This script is how it
 * reaches the live database.
 *
 * Usage:
 *   npx tsx scripts/migrate-api-key-index.ts --dry-run
 *   npx tsx scripts/migrate-api-key-index.ts
 *
 * Required env vars: MONGODB_URI
 */

import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";

const USERS = "users";
const INDEX_KEYS = { "apiKeys.keyHash": 1 } as const;
const INDEX_NAME = "apiKeys.keyHash_1";

const dryRun = process.argv.includes("--dry-run");

function collection(name: string) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle; connectDB did not complete.");
  return db.collection(name);
}

async function indexNames(name: string): Promise<Set<string>> {
  const indexes = await collection(name).indexes();
  return new Set(indexes.map((i) => i.name).filter((n): n is string => typeof n === "string"));
}

async function main() {
  await connectDB();
  console.log(dryRun ? "Dry run: nothing will be written.\n" : "Applying changes.\n");

  const existing = await indexNames(USERS);

  if (existing.has(INDEX_NAME)) {
    console.log(`  users: "${INDEX_NAME}" already exists, nothing to do.`);
  } else if (dryRun) {
    console.log(`  users: would create index "${INDEX_NAME}".`);
  } else {
    await collection(USERS).createIndex(INDEX_KEYS);
    console.log(`  users: created index "${INDEX_NAME}".`);
  }

  // Prove the lookup the application actually performs is now served by the
  // index, rather than trusting that creating it was enough.
  if (!dryRun) {
    const plan = await collection(USERS)
      .find({ "apiKeys.keyHash": "verification-probe-matches-nothing" })
      .explain("queryPlanner");
    const stage = JSON.stringify(plan).includes("IXSCAN") ? "IXSCAN" : "COLLSCAN";
    console.log(`  users: key-hash lookup now plans as ${stage}.`);
    if (stage !== "IXSCAN") {
      throw new Error("Index exists but the key-hash lookup still plans a collection scan.");
    }
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("\nMigration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
