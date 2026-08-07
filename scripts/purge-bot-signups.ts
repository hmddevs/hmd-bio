/**
 * Remove automated signups that got through while Turnstile was unconfigured.
 *
 * Deliberately conservative. A candidate must meet every one of these:
 *   - status "pending" (never approved)
 *   - isVerified false (never confirmed an email address)
 *   - username matches the generator's shape: 16 or more characters, letters
 *     only, mixed case, and no digit, hyphen or underscore
 *   - owns no links
 *
 * A real person who signed up and simply has not confirmed their email yet is
 * very unlikely to clear all four, because a chosen username almost always has
 * a digit, a separator, or is shorter than 16 characters.
 *
 * Dry run by default. Pass --apply to delete.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/purge-bot-signups.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/purge-bot-signups.ts --apply
 */
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");

// 16+ characters, letters only, containing at least one upper and one lower.
const BOT_USERNAME = /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z]{16,}$/;

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle");

  const users = db.collection("users");
  const links = db.collection("links");

  const pending = await users
    .find({ status: "pending", isVerified: { $ne: true } })
    .project({ username: 1, email: 1, createdAt: 1 })
    .toArray();

  const candidates: typeof pending = [];
  const spared: typeof pending = [];

  for (const user of pending) {
    const username = String(user.username ?? "");
    if (!BOT_USERNAME.test(username)) {
      spared.push(user);
      continue;
    }
    const linkCount = await links.countDocuments({ owner: user._id });
    if (linkCount > 0) {
      spared.push(user);
      continue;
    }
    candidates.push(user);
  }

  console.log(`Pending and unverified: ${pending.length}`);
  console.log(`Matching the bot pattern with no links: ${candidates.length}`);
  console.log(`Left alone: ${spared.length}`);

  if (spared.length > 0) {
    console.log("\nLeft alone (review these by eye):");
    for (const user of spared) {
      console.log(`  ${user.username}  ${user.email}`);
    }
  }

  if (candidates.length === 0) {
    console.log("\nNothing to remove.");
    await mongoose.disconnect();
    return;
  }

  console.log("\nFirst 10 candidates:");
  for (const user of candidates.slice(0, 10)) {
    console.log(`  ${user.username}  ${user.email}`);
  }

  if (!APPLY) {
    console.log("\nDry run, nothing deleted. Re-run with --apply to remove them.");
    await mongoose.disconnect();
    return;
  }

  const result = await users.deleteMany({ _id: { $in: candidates.map((c) => c._id) } });
  console.log(`\nDeleted ${result.deletedCount} account(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
