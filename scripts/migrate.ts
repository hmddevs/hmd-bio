/**
 * MySQL → MongoDB Migration Script for HMD.bio
 *
 * Migrates data from the legacy YOURLS MariaDB database to MongoDB Atlas.
 *
 * Usage:
 *   npx tsx scripts/migrate.ts
 *
 * Required env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MONGODB_URI
 */

import mysql from "mysql2/promise";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// MongoDB schemas (inline to avoid import resolution issues with tsx)
// ---------------------------------------------------------------------------

const LinkSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true, unique: true, index: true },
    url: { type: String, required: true },
    title: { type: String, default: "" },
    ip: { type: String, default: "" },
    clicks: { type: Number, default: 0 },
    statusCode: { type: Number, enum: [301, 302], default: 301 },
    isPasswordProtected: { type: Boolean, default: false },
    password: { type: String },
    expiresAt: { type: Date, default: null },
    ogTitle: { type: String, default: null },
    ogDescription: { type: String, default: null },
    ogImage: { type: String, default: null },
  },
  { timestamps: true }
);

const ClickSchema = new mongoose.Schema({
  keyword: { type: String, required: true, index: true },
  referrer: { type: String, default: "" },
  userAgent: { type: String, default: "" },
  ip: { type: String, default: "" },
  countryCode: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});
ClickSchema.index({ keyword: 1, createdAt: -1 });
ClickSchema.index({ countryCode: 1 });

const OptionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "editor"], default: "admin" },
    apiKeys: { type: [{ key: String, label: String, createdAt: Date }], default: [] },
  },
  { timestamps: true }
);

const Link = mongoose.model("Link", LinkSchema);
const Click = mongoose.model("Click", ClickSchema);
const Option = mongoose.model("Option", OptionSchema);
const User = mongoose.model("User", UserSchema);

// ---------------------------------------------------------------------------

interface MysqlLink {
  keyword: string;
  url: string;
  title: string | null;
  timestamp: Date;
  ip: string | null;
  clicks: number;
}

interface MysqlClick {
  click_id: number;
  click_time: Date;
  shorturl: string;
  referrer: string | null;
  user_agent: string | null;
  ip_address: string | null;
  country_code: string | null;
}

interface MysqlOption {
  option_id: number;
  option_name: string;
  option_value: string | null;
}

async function main() {
  const {
    MYSQL_HOST = "localhost",
    MYSQL_USER = "root",
    MYSQL_PASSWORD = "",
    MYSQL_DATABASE = "hmdbio",
    MONGODB_URI,
  } = process.env;

  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI env var is required");
    process.exit(1);
  }

  // --- Connect to both databases ---
  console.log("🔌 Connecting to MySQL…");
  const mysqlConn = await mysql.createConnection({
    host: MYSQL_HOST,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
  });

  console.log("🔌 Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI);

  const skipped: string[] = [];
  let insertedLinks = 0;
  let insertedClicks = 0;
  let insertedOptions = 0;

  try {
    // --- Migrate links ---
    console.log("\n📦 Migrating links…");
    const [linkRows] = await mysqlConn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM yourls_hmdurl"
    );
    const links = linkRows as unknown as MysqlLink[];
    console.log(`   Found ${links.length} links in MySQL`);

    for (const row of links) {
      try {
        await Link.updateOne(
          { keyword: row.keyword },
          {
            $setOnInsert: {
              keyword: row.keyword,
              url: row.url,
              title: row.title || "",
              ip: row.ip || "",
              clicks: row.clicks || 0,
              statusCode: 301,
              isPasswordProtected: false,
              createdAt: row.timestamp,
              updatedAt: row.timestamp,
            },
          },
          { upsert: true }
        );
        insertedLinks++;
      } catch (err) {
        skipped.push(`link:${row.keyword} — ${(err as Error).message}`);
      }
    }
    console.log(`   ✅ Migrated ${insertedLinks} links`);

    // --- Migrate clicks ---
    console.log("\n📦 Migrating clicks…");
    const [clickRows] = await mysqlConn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM yourls_hmdlog ORDER BY click_id ASC"
    );
    const clicks = clickRows as unknown as MysqlClick[];
    console.log(`   Found ${clicks.length} click records in MySQL`);

    // Batch insert for performance
    const BATCH_SIZE = 500;
    for (let i = 0; i < clicks.length; i += BATCH_SIZE) {
      const batch = clicks.slice(i, i + BATCH_SIZE).map((row) => ({
        keyword: row.shorturl,
        referrer: row.referrer || "",
        userAgent: row.user_agent || "",
        ip: row.ip_address || "",
        countryCode: row.country_code || "",
        createdAt: row.click_time,
      }));
      try {
        const result = await Click.insertMany(batch, { ordered: false });
        insertedClicks += result.length;
      } catch (err) {
        // insertMany with ordered:false may partially succeed
        const bulkErr = err as { insertedDocs?: unknown[] };
        insertedClicks += bulkErr.insertedDocs?.length || 0;
        skipped.push(`clicks batch ${i}–${i + BATCH_SIZE}: ${(err as Error).message}`);
      }
    }
    console.log(`   ✅ Migrated ${insertedClicks} click records`);

    // --- Migrate options ---
    console.log("\n📦 Migrating options…");
    const [optionRows] = await mysqlConn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM yourls_hmdoptions"
    );
    const options = optionRows as unknown as MysqlOption[];
    console.log(`   Found ${options.length} options in MySQL`);

    for (const row of options) {
      try {
        let value: unknown = row.option_value;
        // Attempt to parse serialized PHP values or JSON
        if (typeof value === "string") {
          try {
            value = JSON.parse(value);
          } catch {
            // Keep as string if not valid JSON
          }
        }
        await Option.updateOne(
          { key: row.option_name },
          { $set: { key: row.option_name, value } },
          { upsert: true }
        );
        insertedOptions++;
      } catch (err) {
        skipped.push(`option:${row.option_name} — ${(err as Error).message}`);
      }
    }
    console.log(`   ✅ Migrated ${insertedOptions} options`);

    // --- Create default admin user ---
    console.log("\n👤 Creating admin user…");
    const passwordHash = await bcrypt.hash("changeme", 10);
    await User.updateOne(
      { username: "heimdall" },
      {
        $setOnInsert: {
          username: "heimdall",
          passwordHash,
          role: "admin",
          apiKeys: [],
        },
      },
      { upsert: true }
    );
    console.log("   ✅ Admin user 'heimdall' created (password: changeme — change immediately!)");

    // --- Validation ---
    console.log("\n🔍 Validating migration…");
    const mongoLinkCount = await Link.countDocuments();
    const mongoClickCount = await Click.countDocuments();
    const mongoOptionCount = await Option.countDocuments();

    console.log(`   MySQL links:   ${links.length} → MongoDB: ${mongoLinkCount}`);
    console.log(`   MySQL clicks:  ${clicks.length} → MongoDB: ${mongoClickCount}`);
    console.log(`   MySQL options: ${options.length} → MongoDB: ${mongoOptionCount}`);

    if (mongoLinkCount !== links.length) {
      console.warn("   ⚠️  Link count mismatch!");
    }
    if (mongoOptionCount !== options.length) {
      console.warn("   ⚠️  Option count mismatch!");
    }

    if (skipped.length > 0) {
      console.log(`\n⚠️  Skipped/failed records (${skipped.length}):`);
      skipped.forEach((s) => console.log(`   - ${s}`));
    }

    console.log("\n🎉 Migration complete!");
  } finally {
    await mysqlConn.end();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
