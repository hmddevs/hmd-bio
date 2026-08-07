/**
 * Migration: create the indexes the `auditlogs` collection declares, including
 * the retention TTL.
 *
 * MUST BE RUN BEFORE THE ADMINISTRATIVE AUDIT LOG IS RELIED UPON. `autoIndex`
 * is disabled in src/lib/db.ts, because index creation belongs to the scripts
 * in this directory rather than to a serverless instance that might start
 * building one mid-deploy. A `Schema.index()` declaration is therefore inert:
 * without this script the collection has no TTL index at all, entries are kept
 * for ever, and the retention period the feature advertises does not exist.
 * The query indexes matter too, since the DPA question the log answers ("who
 * decrypted an address, and when") is a collection scan without them.
 *
 * The index set is read from the model rather than restated here, so adding a
 * `Schema.index()` to src/models/AuditLog.ts and re-running this script is the
 * whole procedure.
 *
 * Additive and non-destructive: it creates indexes and drops nothing. Safe to
 * re-run, `createIndex` is a no-op when an index with the same specification
 * already exists. The one case that is not a plain no-op is a TTL whose period
 * has been changed in the model: the existing index is then adjusted in place
 * with `collMod`, which rewrites the expiry without dropping the index and
 * leaving the collection unindexed in between.
 *
 * The target database comes solely from the path component of MONGODB_URI, and
 * a URI without one lands silently on `test`. Both the database name and the
 * connection host are therefore printed before anything is applied, and a live
 * run additionally requires --confirm, so indexing the wrong database and
 * reporting success is not something that can happen unnoticed.
 *
 * Usage:
 *   npx tsx scripts/migrate-audit-log-indexes.ts --dry-run
 *   npx tsx scripts/migrate-audit-log-indexes.ts --confirm
 *
 * Required env vars: MONGODB_URI
 */

import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";
import { AuditLog, AUDIT_RETENTION_DAYS } from "../src/models/AuditLog";

type IndexKeys = Record<string, 1 | -1>;

const COLLECTION = AuditLog.collection.collectionName;
const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--confirm");

function db(): mongoose.mongo.Db {
  const conn = mongoose.connection.db;
  if (!conn) throw new Error("No database handle; connectDB did not complete.");
  return conn;
}

function collection() {
  return db().collection(COLLECTION);
}

/**
 * Which database, on which host, this run is about to write to. Read from the
 * live connection rather than re-parsed from the URI, so it reports where the
 * driver actually landed, including the `test` default a URI with no path
 * component silently falls back to.
 */
function target(): { database: string; host: string } {
  const conn = mongoose.connection;
  const port = conn.port ? `:${conn.port}` : "";
  return {
    database: db().databaseName,
    host: conn.host ? `${conn.host}${port}` : "(host not reported by the driver)",
  };
}

/**
 * Two index key patterns are the same index only if the fields match in order
 * as well as in value, since a compound index is prefix-ordered.
 */
function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = Object.entries(a);
  const right = Object.entries(b);
  if (left.length !== right.length) return false;
  return left.every(([field, dir], i) => right[i][0] === field && Number(right[i][1]) === Number(dir));
}

function describe(keys: IndexKeys): string {
  return Object.entries(keys)
    .map(([field, dir]) => `${field}:${dir}`)
    .join(", ");
}

async function existingIndexes() {
  return collection().indexes();
}

/**
 * The declared set, taken straight from the schema. Mongoose returns each
 * declaration as [keys, options], with the TTL carried in `expireAfterSeconds`.
 */
function declaredIndexes(): Array<{ keys: IndexKeys; options: Record<string, unknown> }> {
  const declarations = AuditLog.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown> | undefined]
  >;
  return declarations.map(([keys, options]) => ({
    keys: keys as IndexKeys,
    options: options ?? {},
  }));
}

async function applyIndex(
  keys: IndexKeys,
  options: Record<string, unknown>,
  existing: Awaited<ReturnType<typeof existingIndexes>>
): Promise<void> {
  const label = `{ ${describe(keys)} }`;
  const ttl = options.expireAfterSeconds;
  const match = existing.find((index) => sameKeys(index.key, keys));

  if (!match) {
    if (dryRun) {
      console.log(`  ${COLLECTION}: would create index ${label}${ttl ? ` (TTL ${ttl}s)` : ""}.`);
      return;
    }
    const name = await collection().createIndex(keys, options);
    console.log(`  ${COLLECTION}: created index "${name}" ${label}${ttl ? ` (TTL ${ttl}s)` : ""}.`);
    return;
  }

  const currentTtl = (match as { expireAfterSeconds?: number }).expireAfterSeconds;

  if (typeof ttl === "number" && currentTtl !== ttl) {
    // Changing a TTL by dropping and recreating would leave the collection
    // without that index in between; collMod rewrites it in place.
    if (dryRun) {
      console.log(
        `  ${COLLECTION}: would change TTL on "${match.name}" from ${currentTtl ?? "none"}s to ${ttl}s.`
      );
      return;
    }
    await db().command({
      collMod: COLLECTION,
      index: { name: match.name, expireAfterSeconds: ttl },
    });
    console.log(
      `  ${COLLECTION}: changed TTL on "${match.name}" from ${currentTtl ?? "none"}s to ${ttl}s.`
    );
    return;
  }

  // The model no longer declares a TTL but the live index still carries one, so
  // the server keeps expiring documents on a schedule nothing in the code
  // describes. Removing it is a destructive change and is not this script's job
  // (it drops nothing), but it must not pass as "nothing to do".
  if (typeof ttl !== "number" && typeof currentTtl === "number") {
    console.warn(
      `  WARNING ${COLLECTION}: index "${match.name}" ${label} still expires documents after ` +
        `${currentTtl}s, but the model declares no TTL for it. Retention is running on a ` +
        `schedule the code no longer describes. This script drops nothing: remove the TTL by ` +
        `hand, or restore the declaration in src/models/AuditLog.ts.`
    );
    return;
  }

  console.log(`  ${COLLECTION}: "${match.name}" ${label} already matches, nothing to do.`);
}

async function printState(label: string): Promise<void> {
  const indexes = await existingIndexes();
  const { database, host } = target();
  console.log(`\n=== ${label} ===`);
  console.log(`Database: "${database}" on ${host}.`);
  console.log(`${COLLECTION}: ${await collection().countDocuments({})} document(s).`);
  for (const index of indexes) {
    const ttl = (index as { expireAfterSeconds?: number }).expireAfterSeconds;
    console.log(`  ${index.name}: { ${describe(index.key as IndexKeys)} }${ttl ? ` TTL ${ttl}s` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI env var is required");
    process.exit(1);
  }

  console.log(`Audit log index migration (${dryRun ? "DRY RUN, no writes" : "LIVE RUN"}).`);
  console.log(`Declared retention: ${AUDIT_RETENTION_DAYS} day(s).`);

  await connectDB();

  try {
    const { database, host } = target();

    // The database name is decided by the path component of MONGODB_URI alone,
    // and a URI without one lands on `test`. Naming it and requiring --confirm
    // is what stops a live run indexing the wrong database and reporting
    // success. A dry run writes nothing, so it needs no confirmation.
    if (!dryRun && !confirmed) {
      throw new Error(
        `Refusing a live run without --confirm. This would modify indexes on database ` +
          `"${database}" at ${host}. Re-run with --confirm once that is the intended target, ` +
          `or use --dry-run to see the plan.`
      );
    }

    await printState("Before");

    console.log("\nApplying declared indexes");
    // Re-read once, not per index: a create earlier in the loop cannot affect a
    // later one, because two declarations never share a key pattern.
    const existing = await existingIndexes();
    for (const { keys, options } of declaredIndexes()) {
      await applyIndex(keys, options, existing);
    }

    // Prove the TTL the feature advertises is actually on the collection, rather
    // than trusting that creating it was enough. Skipped in a dry run, where by
    // definition nothing was created.
    if (!dryRun) {
      const after = await existingIndexes();
      const declaredTtls = declaredIndexes().filter(
        ({ options }) => typeof options.expireAfterSeconds === "number"
      );
      if (declaredTtls.length === 0) {
        throw new Error(
          `${COLLECTION}: the model declares no TTL index at all. Retention is NOT enforced.`
        );
      }

      // Match on the exact declared key pattern, never on "some index somewhere
      // has a TTL". The looser test passed whenever any other TTL index existed,
      // so a { createdAt: 1 } TTL that failed to apply still printed success.
      for (const { keys, options } of declaredTtls) {
        const label = `{ ${describe(keys)} }`;
        const expected = options.expireAfterSeconds as number;
        const match = after.find((index) => sameKeys(index.key, keys));
        if (!match) {
          throw new Error(
            `${COLLECTION}: no index ${label} present after migration. Retention is NOT enforced.`
          );
        }
        const actual = (match as { expireAfterSeconds?: number }).expireAfterSeconds;
        if (actual !== expected) {
          throw new Error(
            `${COLLECTION}: index "${match.name}" ${label} expires after ${actual ?? "never"}s, ` +
              `but the model declares ${expected}s. Retention is NOT as advertised.`
          );
        }
        console.log(
          `\n  ${COLLECTION}: retention verified, "${match.name}" ${label} expires documents ` +
            `after ${expected}s (${Math.round(expected / 86400)} day(s)).`
        );
      }
    }

    await printState("After");
    console.log(`\nMigration ${dryRun ? "dry run" : "run"} complete.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("\nMigration FAILED:", err instanceof Error ? err.message : err);
  console.error("Nothing was dropped. Investigate before re-running.");
  process.exit(1);
});
