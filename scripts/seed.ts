/**
 * Seed script — migrates data from the YOURLS SQL dump (hmd_url.sql) into MongoDB.
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *
 * Env:
 *   MONGODB_URI  — MongoDB connection string (falls back to .env / .env.local)
 */

import * as fs from "fs";
import * as path from "path";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// ── Mongoose schemas (inline to avoid import issues with tsx) ────────────────

const LinkSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true, unique: true, index: true, trim: true },
    url: { type: String, required: true },
    title: { type: String, default: "" },
    ip: { type: String, default: "" },
    clicks: { type: Number, default: 0, min: 0 },
    statusCode: { type: Number, enum: [301, 302], default: 301 },
    isPasswordProtected: { type: Boolean, default: false },
    password: { type: String, select: false },
    expiresAt: { type: Date, default: null },
    ogTitle: { type: String, default: null },
    ogDescription: { type: String, default: null },
    ogImage: { type: String, default: null },
  },
  { timestamps: true }
);
LinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

const ClickSchema = new mongoose.Schema(
  {
    keyword: { type: String, required: true, index: true },
    referrer: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    countryCode: { type: String, default: "", maxlength: 2 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
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
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "editor"], default: "editor" },
    apiKeys: [
      {
        key: String,
        label: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

const Link = mongoose.models.Link || mongoose.model("Link", LinkSchema);
const Click = mongoose.models.Click || mongoose.model("Click", ClickSchema);
const Option = mongoose.models.Option || mongoose.model("Option", OptionSchema);
const User = mongoose.models.User || mongoose.model("User", UserSchema);

// ── SQL parsing helpers ──────────────────────────────────────────────────────

/**
 * Extract all INSERT row tuples from the SQL dump for a given table.
 * Handles multi-line INSERT INTO ... VALUES blocks and escaped strings.
 */
function extractInsertRows(sql: string, tableName: string): string[][] {
  const rows: string[][] = [];

  // Match all INSERT INTO `tableName` ... VALUES blocks
  const insertRegex = new RegExp(
    `INSERT INTO \`${tableName}\`\\s*\\([^)]+\\)\\s*VALUES\\s*`,
    "gi"
  );

  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(sql)) !== null) {
    let pos = match.index + match[0].length;

    // Parse each row tuple
    while (pos < sql.length) {
      // Skip whitespace / newlines
      while (pos < sql.length && /[\s\n\r]/.test(sql[pos])) pos++;

      if (sql[pos] !== "(") break;
      pos++; // skip opening paren

      const fields: string[] = [];
      let field = "";
      let inString = false;
      let escape = false;

      while (pos < sql.length) {
        const ch = sql[pos];

        if (escape) {
          // Handle YOURLS-style escaped chars
          if (ch === "'" || ch === "\\" || ch === "/") {
            field += ch;
          } else {
            field += "\\" + ch;
          }
          escape = false;
          pos++;
          continue;
        }

        if (ch === "\\") {
          escape = true;
          pos++;
          continue;
        }

        if (ch === "'" && !inString) {
          inString = true;
          pos++;
          continue;
        }

        if (ch === "'" && inString) {
          // Check for '' (escaped single quote in SQL)
          if (pos + 1 < sql.length && sql[pos + 1] === "'") {
            field += "'";
            pos += 2;
            continue;
          }
          inString = false;
          pos++;
          continue;
        }

        if (!inString) {
          if (ch === ",") {
            fields.push(field.trim());
            field = "";
            pos++;
            continue;
          }
          if (ch === ")") {
            fields.push(field.trim());
            pos++;
            break;
          }
        }

        field += ch;
        pos++;
      }

      if (fields.length > 0) {
        rows.push(fields);
      }

      // Skip comma / semicolon between tuples
      while (pos < sql.length && /[\s\n\r,]/.test(sql[pos])) pos++;
      if (sql[pos] === ";") {
        pos++;
        break;
      }
    }
  }

  return rows;
}

/** Clean NULL literal or empty string */
function cleanValue(v: string): string {
  if (v === "NULL" || v === "null") return "";
  return v;
}

// ── Password-protected link mapping ──────────────────────────────────────────

// From the yourls_hmdoptions row 15 — bcrypt hashes for password-protected links
const PASSWORD_PROTECTED_KEYWORDS = new Set([
  "LjaRB",
  "3bP1T",
  "M4W3u",
  "damla",
  "damla2",
  "btbfinal",
]);

// ── Main seeding function ────────────────────────────────────────────────────

async function seed() {
  // Load env
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Create .env.local or set the env var.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected.");

  // Read the SQL dump
  const sqlPath = path.resolve(process.cwd(), "hmd_url.sql");
  if (!fs.existsSync(sqlPath)) {
    console.error(`SQL dump not found at ${sqlPath}`);
    process.exit(1);
  }
  console.log("Reading SQL dump...");
  const sql = fs.readFileSync(sqlPath, "utf-8");
  console.log(`SQL dump loaded (${(sql.length / 1024 / 1024).toFixed(1)} MB)`);

  // ── 1. Seed Links ──────────────────────────────────────────────────────────

  console.log("\n--- Seeding Links ---");
  const urlRows = extractInsertRows(sql, "yourls_hmdurl");
  console.log(`Parsed ${urlRows.length} link records from SQL`);

  // SQL columns: keyword, url, title, timestamp, ip, clicks
  const linkDocs = urlRows.map((row) => {
    const keyword = cleanValue(row[0]);
    const url = cleanValue(row[1]);
    const title = cleanValue(row[2]);
    const timestamp = cleanValue(row[3]);
    const ip = cleanValue(row[4]);
    const clicks = parseInt(cleanValue(row[5]) || "0", 10);
    const isPasswordProtected = PASSWORD_PROTECTED_KEYWORDS.has(keyword);

    const ts = timestamp ? new Date(timestamp + " UTC") : new Date();
    return {
      doc: {
        keyword,
        url,
        title,
        ip,
        clicks,
        statusCode: 302, // YOURLS used the 302-instead plugin
        isPasswordProtected,
        expiresAt: null,
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
      },
      ts,
    };
  });

  // Upsert links (idempotent)
  let linksInserted = 0;
  let linksUpdated = 0;
  for (const { doc, ts } of linkDocs) {
    const result = await Link.updateOne(
      { keyword: doc.keyword },
      {
        $setOnInsert: { ...doc, createdAt: ts },
        $set: { updatedAt: ts },
      },
      { upsert: true, timestamps: false }
    );
    if (result.upsertedCount > 0) linksInserted++;
    else linksUpdated++;
  }
  console.log(`Links: ${linksInserted} inserted, ${linksUpdated} already existed`);

  // ── 2. Seed Clicks ─────────────────────────────────────────────────────────

  console.log("\n--- Seeding Clicks ---");
  const clickRows = extractInsertRows(sql, "yourls_hmdlog");
  console.log(`Parsed ${clickRows.length} click records from SQL`);

  // SQL columns: click_id, click_time, shorturl, referrer, user_agent, ip_address, country_code
  const BATCH_SIZE = 1000;
  let clicksInserted = 0;

  // Check if clicks already seeded (avoid duplicates on re-run)
  const existingClickCount = await Click.countDocuments();
  if (existingClickCount > 0) {
    console.log(
      `Clicks collection already has ${existingClickCount} docs. Skipping click import to avoid duplicates.`
    );
    console.log("To re-seed clicks, drop the clicks collection first.");
  } else {
    for (let i = 0; i < clickRows.length; i += BATCH_SIZE) {
      const batch = clickRows.slice(i, i + BATCH_SIZE).map((row) => {
        const clickTime = cleanValue(row[1]);
        const referrer = cleanValue(row[3]);

        return {
          keyword: cleanValue(row[2]),
          referrer: referrer === "direct" ? "" : referrer,
          userAgent: cleanValue(row[4]),
          ip: cleanValue(row[5]),
          countryCode: cleanValue(row[6]),
          createdAt: clickTime ? new Date(clickTime + " UTC") : new Date(),
        };
      });

      await Click.insertMany(batch, { ordered: false });
      clicksInserted += batch.length;

      if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= clickRows.length) {
        console.log(`  Progress: ${Math.min(i + BATCH_SIZE, clickRows.length)}/${clickRows.length}`);
      }
    }
    console.log(`Clicks: ${clicksInserted} inserted`);
  }

  // ── 3. Seed Options ────────────────────────────────────────────────────────

  console.log("\n--- Seeding Options ---");
  const optionRows = extractInsertRows(sql, "yourls_hmdoptions");
  console.log(`Parsed ${optionRows.length} option records from SQL`);

  // Map useful YOURLS options only — skip login_timeouts, reCAPTCHA keys, and other stale data
  const SKIP_OPTIONS = new Set([
    "core_version_checks",
    "test_option",
    "adminnorecaptcha_pub_key",
    "adminnorecaptcha_priv_key",
    "next_id",
    "db_version",
    "active_plugins",
    "matthew_pwprotection", // passwords already mapped to links
  ]);

  let optionsInserted = 0;
  for (const row of optionRows) {
    const key = cleanValue(row[1]);
    const value = cleanValue(row[2]);

    if (SKIP_OPTIONS.has(key) || key.startsWith("login_timeouts")) continue;

    // Transform relevant options
    let transformedKey = key;
    let transformedValue: unknown = value;

    switch (key) {
      case "version":
        transformedKey = "yourls_version";
        transformedValue = value;
        break;
      case "theme_choice":
        transformedKey = "theme";
        transformedValue = value;
        break;
      default:
        transformedKey = key;
        transformedValue = value;
    }

    await Option.updateOne(
      { key: transformedKey },
      { $setOnInsert: { key: transformedKey, value: transformedValue } },
      { upsert: true, timestamps: false }
    );
    optionsInserted++;
  }
  console.log(`Options: ${optionsInserted} processed`);

  // ── 4. Seed Admin User ─────────────────────────────────────────────────────

  console.log("\n--- Seeding Admin User ---");
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!seedPassword) {
    console.log("SEED_ADMIN_PASSWORD not set — skipping admin user seed.");
  } else {
    const hash = await bcrypt.hash(seedPassword, 12);
    const userResult = await User.updateOne(
      { username: "heimdall" },
      {
        $setOnInsert: {
          username: "heimdall",
          passwordHash: hash,
          role: "admin",
          apiKeys: [],
        },
      },
      { upsert: true, timestamps: false }
    );
    if (userResult.upsertedCount > 0) {
      console.log("Admin user 'heimdall' created.");
    } else {
      console.log("Admin user 'heimdall' already exists");
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  const finalCounts = {
    links: await Link.countDocuments(),
    clicks: await Click.countDocuments(),
    options: await Option.countDocuments(),
    users: await User.countDocuments(),
  };

  console.log("\n=== Seed Complete ===");
  console.log(`  Links:   ${finalCounts.links}`);
  console.log(`  Clicks:  ${finalCounts.clicks}`);
  console.log(`  Options: ${finalCounts.options}`);
  console.log(`  Users:   ${finalCounts.users}`);

  await mongoose.disconnect();
  console.log("Disconnected.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
