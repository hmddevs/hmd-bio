/**
 * Migration: add `domain` to links and clicks, and move link uniqueness from
 * a global `keyword_1` unique index to a compound `{ domain: 1, keyword: 1 }`
 * unique index.
 *
 * This sits directly on the live redirect path, so the ordering below is
 * mandatory and is enforced in code. Each step must succeed before the next
 * one is attempted, and no step drops anything until its replacement exists.
 *
 *   1. Backfill `domain` = PRIMARY_DOMAIN on every doc missing the field,
 *      in both `links` and `clicks`.
 *   2. Assert zero docs remain without `domain`. Throw and stop otherwise.
 *   3. Create the unique `{ domain: 1, keyword: 1 }` index on `links`.
 *      On a duplicate-key failure, print the offending pairs and abort
 *      without dropping anything.
 *   4. Only then, drop the legacy `keyword_1` index if it is still there.
 *   5. Only then, sync the `clicks` analytics indexes to lead with `domain`,
 *      creating the new ones before dropping the superseded keyword-leading
 *      ones.
 *
 * Idempotent: a second run finds nothing to backfill, finds the new indexes
 * already present, and finds the old ones already gone.
 *
 * MUST be run manually by a human, against a copy of production first.
 * Dry-run first.
 *
 * Usage:
 *   npx tsx scripts/migrate-add-domain.ts --dry-run
 *   npx tsx scripts/migrate-add-domain.ts
 *
 * Required env vars: MONGODB_URI (and NEXT_PUBLIC_PRIMARY_DOMAIN if the
 * primary domain is not hmd.bio).
 */

import mongoose from "mongoose";
import { connectDB } from "../src/lib/db";
import { PRIMARY_DOMAIN } from "../src/lib/domains";

const LINKS = "links";
const CLICKS = "clicks";

const LEGACY_KEYWORD_INDEX = "keyword_1";
const NEW_LINK_INDEX_NAME = "domain_1_keyword_1";

/** Analytics indexes on `clicks`: the old keyword-leading name, and its replacement. */
const CLICK_INDEX_MIGRATIONS: Array<{
  legacyName: string;
  newName: string;
  newKeys: Record<string, 1 | -1>;
}> = [
  {
    legacyName: "keyword_1_createdAt_-1",
    newName: "domain_1_keyword_1_createdAt_-1",
    newKeys: { domain: 1, keyword: 1, createdAt: -1 },
  },
  {
    legacyName: "keyword_1_referrer_1",
    newName: "domain_1_keyword_1_referrer_1",
    newKeys: { domain: 1, keyword: 1, referrer: 1 },
  },
  {
    legacyName: "keyword_1_browser_1",
    newName: "domain_1_keyword_1_browser_1",
    newKeys: { domain: 1, keyword: 1, browser: 1 },
  },
  {
    legacyName: "keyword_1_os_1",
    newName: "domain_1_keyword_1_os_1",
    newKeys: { domain: 1, keyword: 1, os: 1 },
  },
];

function db(): mongoose.mongo.Db {
  const conn = mongoose.connection.db;
  if (!conn) throw new Error("No active MongoDB connection");
  return conn;
}

function collection(name: string) {
  return db().collection(name);
}

async function indexNames(name: string): Promise<Set<string>> {
  const indexes = await collection(name).indexes();
  return new Set(indexes.map((i) => String(i.name)));
}

function isDuplicateKeyError(err: unknown): boolean {
  const code = (err as { code?: number } | null)?.code;
  return code === 11000 || code === 11001;
}

function isIndexNotFoundError(err: unknown): boolean {
  const code = (err as { code?: number } | null)?.code;
  const message = (err as Error | null)?.message ?? "";
  return code === 27 || /index not found/i.test(message);
}

// ---------------------------------------------------------------------------
// Step 1 — backfill
// ---------------------------------------------------------------------------

async function backfill(name: string, dryRun: boolean): Promise<void> {
  const filter = { domain: { $exists: false } };
  const pending = await collection(name).countDocuments(filter);

  if (pending === 0) {
    console.log(`  ${name}: already backfilled, 0 document(s) missing "domain".`);
    return;
  }

  if (dryRun) {
    console.log(
      `  ${name}: would set domain="${PRIMARY_DOMAIN}" on ${pending} document(s).`
    );
    return;
  }

  // Backfill in batches. A single updateMany over a large collection can exceed
  // the driver's socketTimeoutMS (30s), which aborts the migration mid-step.
  // Batching keeps every write well inside that window and makes a resumed run
  // pick up exactly where an interrupted one stopped.
  const BATCH_SIZE = 5000;
  let modified = 0;

  for (;;) {
    const batch = await collection(name)
      .find(filter, { projection: { _id: 1 } })
      .limit(BATCH_SIZE)
      .toArray();

    if (batch.length === 0) break;

    const result = await collection(name).updateMany(
      { _id: { $in: batch.map((doc) => doc._id) } },
      { $set: { domain: PRIMARY_DOMAIN } }
    );
    modified += result.modifiedCount;
    console.log(`  ${name}: ${modified}/${pending} document(s) backfilled.`);
  }

  console.log(`  ${name}: backfill complete, ${modified} document(s) modified.`);
}

// ---------------------------------------------------------------------------
// Step 2 — assert
// ---------------------------------------------------------------------------

async function assertFullyBackfilled(name: string, dryRun: boolean): Promise<void> {
  const remaining = await collection(name).countDocuments({
    $or: [{ domain: { $exists: false } }, { domain: null }, { domain: "" }],
  });

  if (remaining === 0) {
    console.log(`  ${name}: verified, every document has a non-empty "domain".`);
    return;
  }

  if (dryRun) {
    console.log(
      `  ${name}: ${remaining} document(s) still lack "domain" (expected in a dry run, ` +
        `since nothing was written). A live run would backfill them first.`
    );
    return;
  }

  throw new Error(
    `${name}: ${remaining} document(s) still lack a usable "domain" after backfill. ` +
      `Refusing to touch indexes. Investigate before re-running.`
  );
}

// ---------------------------------------------------------------------------
// Step 3 — create the compound unique index on links
// ---------------------------------------------------------------------------

async function reportDuplicateKeywordPairs(): Promise<void> {
  const duplicates = await collection(LINKS)
    .aggregate([
      { $group: { _id: { domain: "$domain", keyword: "$keyword" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 100 },
    ])
    .toArray();

  console.error(
    `Found ${duplicates.length} duplicate (domain, keyword) pair(s) (showing up to 100):`
  );
  for (const d of duplicates) {
    console.error(`  domain="${d._id?.domain}" keyword="${d._id?.keyword}" count=${d.count}`);
  }
}

async function createCompoundUniqueIndex(dryRun: boolean): Promise<void> {
  const existing = await indexNames(LINKS);

  if (existing.has(NEW_LINK_INDEX_NAME)) {
    console.log(`  links: "${NEW_LINK_INDEX_NAME}" already exists.`);
    return;
  }

  if (dryRun) {
    console.log(`  links: would create unique index "${NEW_LINK_INDEX_NAME}".`);
    const conflicts = await collection(LINKS)
      .aggregate([
        { $group: { _id: { domain: "$domain", keyword: "$keyword" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: "pairs" },
      ])
      .toArray();
    const pairs = conflicts[0]?.pairs ?? 0;
    if (pairs > 0) {
      console.log(
        `  links: WARNING — ${pairs} duplicate (domain, keyword) pair(s) would block ` +
          `the unique index. Resolve them before a live run.`
      );
    } else {
      console.log(`  links: no duplicate (domain, keyword) pairs, index creation should succeed.`);
    }
    return;
  }

  try {
    await collection(LINKS).createIndex({ domain: 1, keyword: 1 }, { unique: true });
    console.log(`  links: created unique index "${NEW_LINK_INDEX_NAME}".`);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      console.error(
        `  links: FAILED to create the unique index because duplicate (domain, keyword) ` +
          `pairs exist. Nothing has been dropped.`
      );
      await reportDuplicateKeywordPairs();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 4 — drop the legacy global unique index on keyword
// ---------------------------------------------------------------------------

async function dropLegacyKeywordIndex(dryRun: boolean): Promise<void> {
  const existing = await indexNames(LINKS);

  if (!existing.has(LEGACY_KEYWORD_INDEX)) {
    console.log(`  links: legacy "${LEGACY_KEYWORD_INDEX}" already gone.`);
    return;
  }

  if (dryRun) {
    console.log(`  links: would drop legacy index "${LEGACY_KEYWORD_INDEX}".`);
    return;
  }

  // Guard the ordering explicitly: never drop the old index unless the new
  // one is present and confirmed, even if an earlier step was skipped.
  const afterCreate = await indexNames(LINKS);
  if (!afterCreate.has(NEW_LINK_INDEX_NAME)) {
    throw new Error(
      `links: refusing to drop "${LEGACY_KEYWORD_INDEX}" because ` +
        `"${NEW_LINK_INDEX_NAME}" is not present.`
    );
  }

  try {
    await collection(LINKS).dropIndex(LEGACY_KEYWORD_INDEX);
    console.log(`  links: dropped legacy index "${LEGACY_KEYWORD_INDEX}".`);
  } catch (err) {
    if (isIndexNotFoundError(err)) {
      console.log(`  links: legacy "${LEGACY_KEYWORD_INDEX}" already gone (concurrent drop).`);
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 5 — swap the clicks analytics indexes to lead with domain
// ---------------------------------------------------------------------------

async function syncClickIndexes(dryRun: boolean): Promise<void> {
  const existing = await indexNames(CLICKS);

  for (const migration of CLICK_INDEX_MIGRATIONS) {
    if (existing.has(migration.newName)) {
      console.log(`  clicks: "${migration.newName}" already exists.`);
    } else if (dryRun) {
      console.log(`  clicks: would create index "${migration.newName}".`);
    } else {
      await collection(CLICKS).createIndex(migration.newKeys);
      console.log(`  clicks: created index "${migration.newName}".`);
    }

    const newIndexPresent =
      dryRun || existing.has(migration.newName) || (await indexNames(CLICKS)).has(migration.newName);

    if (!existing.has(migration.legacyName)) {
      console.log(`  clicks: legacy "${migration.legacyName}" already gone.`);
      continue;
    }

    if (dryRun) {
      console.log(`  clicks: would drop legacy index "${migration.legacyName}".`);
      continue;
    }

    if (!newIndexPresent) {
      throw new Error(
        `clicks: refusing to drop "${migration.legacyName}" because ` +
          `"${migration.newName}" is not present.`
      );
    }

    try {
      await collection(CLICKS).dropIndex(migration.legacyName);
      console.log(`  clicks: dropped legacy index "${migration.legacyName}".`);
    } catch (err) {
      if (isIndexNotFoundError(err)) {
        console.log(`  clicks: legacy "${migration.legacyName}" already gone.`);
        continue;
      }
      throw err;
    }
  }

  // The standalone keyword index is superseded by the { domain, keyword, ... }
  // prefix, but it is cheap and harmless; drop it only once a replacement is
  // definitely in place.
  const keywordOnly = await indexNames(CLICKS);
  if (keywordOnly.has(LEGACY_KEYWORD_INDEX)) {
    if (dryRun) {
      console.log(`  clicks: would drop standalone "${LEGACY_KEYWORD_INDEX}".`);
    } else if (keywordOnly.has(CLICK_INDEX_MIGRATIONS[0].newName)) {
      try {
        await collection(CLICKS).dropIndex(LEGACY_KEYWORD_INDEX);
        console.log(`  clicks: dropped standalone "${LEGACY_KEYWORD_INDEX}".`);
      } catch (err) {
        if (!isIndexNotFoundError(err)) throw err;
      }
    }
  } else {
    console.log(`  clicks: standalone "${LEGACY_KEYWORD_INDEX}" already gone.`);
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

async function printState(label: string): Promise<void> {
  console.log(`\n=== ${label} ===`);
  for (const name of [LINKS, CLICKS]) {
    const total = await collection(name).countDocuments({});
    const missing = await collection(name).countDocuments({ domain: { $exists: false } });
    const indexes = await collection(name).indexes();
    console.log(
      `${name}: ${total} document(s), ${missing} without "domain". Indexes: ` +
        indexes.map((i) => i.name).join(", ")
    );
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI env var is required");
    process.exit(1);
  }

  console.log(`Custom-domain migration (${dryRun ? "DRY RUN, no writes" : "LIVE RUN"}).`);
  console.log(`PRIMARY_DOMAIN = "${PRIMARY_DOMAIN}"`);

  await connectDB();

  try {
    await printState("Before");

    console.log("\nStep 1/5 — backfill domain");
    await backfill(LINKS, dryRun);
    await backfill(CLICKS, dryRun);

    console.log("\nStep 2/5 — verify backfill");
    await assertFullyBackfilled(LINKS, dryRun);
    await assertFullyBackfilled(CLICKS, dryRun);

    console.log("\nStep 3/5 — create unique { domain, keyword } index on links");
    await createCompoundUniqueIndex(dryRun);

    console.log("\nStep 4/5 — drop legacy keyword_1 index on links");
    await dropLegacyKeywordIndex(dryRun);

    console.log("\nStep 5/5 — sync clicks analytics indexes");
    await syncClickIndexes(dryRun);

    await printState("After");
    console.log(`\nMigration ${dryRun ? "dry run" : "run"} complete.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("\nMigration FAILED:", err instanceof Error ? err.message : err);
  console.error("No further steps were attempted. Nothing was dropped after the failure point.");
  process.exit(1);
});
