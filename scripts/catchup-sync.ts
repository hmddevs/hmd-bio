/**
 * Catch-up sync: pulls current link & click data from YOURLS API
 * and upserts into MongoDB to close the gap between the last
 * SQL-dump migration and plugin activation.
 *
 * Usage:
 *   npx tsx scripts/catchup-sync.ts
 *
 * Env (reads .env.local):
 *   MONGODB_URI, YOURLS_API_URL, YOURLS_API_SIGNATURE
 *
 * You need a YOURLS signature token — find it at hmd.bio/admin/tools.php
 * Add to .env.local:
 *   YOURLS_API_URL=https://hmd.bio/yourls-api.php
 *   YOURLS_API_SIGNATURE=your_signature_token
 */

import mongoose from "mongoose";
import * as fs from "fs";
import * as path from "path";
import { Link } from "../src/models/Link";
import { Click } from "../src/models/Click";
import { encryptIP } from "../src/lib/ip";
import { PRIMARY_DOMAIN } from "../src/lib/domains";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const MONGODB_URI = process.env.MONGODB_URI!;
const API_URL = process.env.YOURLS_API_URL!;
const SIGNATURE = process.env.YOURLS_API_SIGNATURE!;

if (!MONGODB_URI || !API_URL || !SIGNATURE) {
  console.error("❌ Required env vars: MONGODB_URI, YOURLS_API_URL, YOURLS_API_SIGNATURE");
  process.exit(1);
}

// ── YOURLS API helper ────────────────────────────────────────────────────────
async function yourlsApi(params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams({ signature: SIGNATURE, format: "json", ...params });
  const res = await fetch(API_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`YOURLS API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("🔌 Connected to MongoDB\n");

  // 1. Get total link count from YOURLS stats
  const statsRes = (await yourlsApi({ action: "stats" })) as {
    stats: { total_links: string; total_clicks: string };
  };
  const totalLinks = parseInt(statsRes.stats.total_links, 10);
  const totalClicks = parseInt(statsRes.stats.total_clicks, 10);
  console.log(`📊 YOURLS reports: ${totalLinks} links, ${totalClicks} clicks`);

  // 2. Fetch all links in pages (YOURLS "stats" action with filter=top, limit)
  const PAGE_SIZE = 100;
  let synced = 0;
  let clicksUpdated = 0;
  let newLinks = 0;

  for (let offset = 0; offset < totalLinks + PAGE_SIZE; offset += PAGE_SIZE) {
    const page = (await yourlsApi({
      action: "stats",
      filter: "top",
      limit: String(PAGE_SIZE),
      start: String(offset),
    })) as { links: Record<string, { shorturl: string; url: string; title: string; ip: string; clicks: string; timestamp: string }> };

    const links = page.links;
    if (!links || Object.keys(links).length === 0) break;

    for (const [, link] of Object.entries(links)) {
      const keyword = link.shorturl.replace(/^https?:\/\/hmd\.bio\//, "");
      const clickCount = parseInt(link.clicks, 10) || 0;

      // Pinned to the primary domain on every query, exactly like
      // /api/internal/sync. This is legacy YOURLS data, which only ever existed
      // on hmd.bio; an unscoped keyword query would now match a tenant's link on
      // a custom domain and overwrite its click count.
      const existing = await Link.findOne({ domain: PRIMARY_DOMAIN, keyword });
      if (existing) {
        // Use $max so we never overwrite a higher MongoDB count
        // (safe to run even after Vercel starts receiving direct traffic)
        if (existing.clicks < clickCount) {
          await Link.updateOne({ domain: PRIMARY_DOMAIN, keyword }, { $max: { clicks: clickCount } });
          clicksUpdated++;
        }
      } else {
        // New link not yet in MongoDB
        const encrypted = link.ip ? encryptIP(link.ip) : { ciphertext: "", iv: "" };
        await Link.create({
          domain: PRIMARY_DOMAIN,
          keyword,
          url: link.url,
          title: link.title || "",
          ipRaw: encrypted.ciphertext,
          ipIv: encrypted.iv,
          clicks: clickCount,
          statusCode: 301,
          isPasswordProtected: false,
          createdAt: link.timestamp ? new Date(link.timestamp) : new Date(),
        });
        newLinks++;
      }
      synced++;
    }
    console.log(`   Processed ${synced} / ~${totalLinks} links...`);
  }

  // 3. Summary. Scoped to the primary domain as well, so the figures stay
  // comparable with what YOURLS reports rather than counting tenants' links.
  const mongoLinkCount = await Link.countDocuments({ domain: PRIMARY_DOMAIN });
  const mongoClickDocs = await Click.countDocuments({ domain: PRIMARY_DOMAIN });

  console.log(`\n✅ Catch-up complete:`);
  console.log(`   New links added: ${newLinks}`);
  console.log(`   Click counts updated: ${clicksUpdated}`);
  console.log(`   MongoDB now has: ${mongoLinkCount} links, ${mongoClickDocs} click log entries`);
  console.log(`   YOURLS reports:  ${totalLinks} links, ${totalClicks} total clicks`);

  if (mongoLinkCount === totalLinks) {
    console.log(`\n🎉 Link counts match perfectly!`);
  } else {
    console.log(`\n⚠️  Link count mismatch — ${totalLinks - mongoLinkCount} still missing`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
