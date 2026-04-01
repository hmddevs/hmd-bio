/**
 * Backfill Click Logs from MySQL (yourls_hmdlog) → MongoDB
 *
 * Pulls historical click data from the legacy YOURLS database and inserts
 * them as MongoDB Click documents, parsing user agents with ua-parser-js.
 *
 * Usage:
 *   npx tsx scripts/backfill-clicks.ts
 *
 * Required env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MONGODB_URI
 */

import mysql from "mysql2/promise";
import mongoose from "mongoose";
import { UAParser } from "ua-parser-js";

// ---------------------------------------------------------------------------
// MongoDB schema (inline to avoid import resolution issues with tsx)
// ---------------------------------------------------------------------------

const ClickSchema = new mongoose.Schema({
  keyword: { type: String, required: true, index: true },
  referrer: { type: String, default: "" },
  userAgent: { type: String, default: "" },
  browser: { type: String, default: "" },
  os: { type: String, default: "" },
  ip: { type: String, default: "" },
  countryCode: { type: String, default: "", maxlength: 2 },
  createdAt: { type: Date, default: Date.now },
});
ClickSchema.index({ keyword: 1, createdAt: -1 });
ClickSchema.index({ countryCode: 1 });

const Click = mongoose.model("Click", ClickSchema);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BATCH_SIZE = 1000;

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "yourls",
};

const MONGODB_URI = process.env.MONGODB_URI || "";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI env var is required");
    process.exit(1);
  }

  console.log("🔌 Connecting to MySQL...");
  const mysqlConn = await mysql.createConnection(MYSQL_CONFIG);

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);

  // Count total rows
  const [countRows] = await mysqlConn.execute(
    "SELECT COUNT(*) as total FROM yourls_hmdlog"
  );
  const total = (countRows as Array<{ total: number }>)[0].total;
  console.log(`📊 Found ${total} click logs to migrate`);

  let offset = 0;
  let imported = 0;
  let skipped = 0;

  while (offset < total) {
    const [rows] = await mysqlConn.execute(
      `SELECT click_id, click_time, shorturl, referrer, user_agent, ip_address, country_code
       FROM yourls_hmdlog
       ORDER BY click_id ASC
       LIMIT ? OFFSET ?`,
      [BATCH_SIZE, offset]
    );

    const batch = rows as Array<{
      click_id: number;
      click_time: string;
      shorturl: string;
      referrer: string;
      user_agent: string;
      ip_address: string;
      country_code: string;
    }>;

    if (batch.length === 0) break;

    const docs = batch.map((row) => {
      const ua = UAParser(row.user_agent);
      return {
        keyword: row.shorturl,
        referrer: row.referrer || "",
        userAgent: row.user_agent || "",
        ip: row.ip_address || "",
        countryCode: (row.country_code || "").toUpperCase().slice(0, 2),
        createdAt: new Date(row.click_time),
      };
    });

    try {
      const result = await Click.insertMany(docs, { ordered: false });
      imported += result.length;
    } catch (err: unknown) {
      // insertMany with ordered:false throws on duplicates but still inserts valid docs
      const mongoErr = err as { insertedDocs?: unknown[] };
      if (mongoErr.insertedDocs) {
        imported += mongoErr.insertedDocs.length;
        skipped += batch.length - mongoErr.insertedDocs.length;
      } else {
        skipped += batch.length;
      }
    }

    offset += BATCH_SIZE;
    const pct = Math.min(100, Math.round((offset / total) * 100));
    process.stdout.write(`\r⏳ Progress: ${pct}% (${imported} imported, ${skipped} skipped)`);
  }

  console.log(`\n✅ Done! Imported ${imported} clicks, skipped ${skipped}`);

  await mysqlConn.end();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});
