/**
 * One-time migration: assign all existing links to the admin user (heimdall).
 *
 * Usage: npx tsx scripts/assign-links-to-admin.ts
 */
import mongoose from "mongoose";
import { User } from "../src/models/User";
import { Link } from "../src/models/Link";

const ADMIN_USERNAME = "heimdall";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const admin = await User.findOne({ username: ADMIN_USERNAME });
  if (!admin) {
    console.error(`Admin user "${ADMIN_USERNAME}" not found. Create it first.`);
    process.exit(1);
  }

  const result = await Link.updateMany(
    { owner: null },
    { $set: { owner: admin._id } }
  );

  console.log(`Assigned ${result.modifiedCount} link(s) to admin "${ADMIN_USERNAME}" (${admin._id})`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
