/**
 * Backfill Link Ownership
 *
 * Assigns all existing links with owner=null to the first admin user.
 * These are pre-user-system links (migrated from YOURLS) that should
 * belong to the admin.
 *
 * Usage:
 *   npx tsx scripts/backfill-owners.ts
 *
 * Required env: MONGODB_URI (or .env.local)
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const LinkSchema = new mongoose.Schema({
  keyword: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: Date,
});

const UserSchema = new mongoose.Schema({
  username: String,
  role: { type: String, enum: ["admin", "user"] },
});

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI is required");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("🔌 Connected to MongoDB");

  const User = mongoose.model("User", UserSchema);
  const Link = mongoose.model("Link", LinkSchema);

  // Find the admin user
  const admin = await User.findOne({ role: "admin" }).lean();
  if (!admin) {
    console.error("❌ No admin user found. Create one first.");
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`👤 Admin: ${admin.username} (${admin._id})`);

  // Count ownerless links
  const count = await Link.countDocuments({ owner: null });
  console.log(`📦 Found ${count} links with no owner`);

  if (count === 0) {
    console.log("✅ Nothing to backfill");
    await mongoose.disconnect();
    return;
  }

  // Assign all ownerless links to admin
  const result = await Link.updateMany(
    { owner: null },
    { $set: { owner: admin._id } }
  );

  console.log(`✅ Updated ${result.modifiedCount} links → owner: ${admin.username}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
