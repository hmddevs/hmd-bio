/**
 * Creates the default admin user in MongoDB Atlas.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts
 *
 * Env: MONGODB_URI (reads from .env.local)
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import * as fs from "fs";
import * as path from "path";

// Read .env.local
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "editor"], default: "editor" },
    apiKeys: [{ key: String, label: String, createdAt: { type: Date, default: Date.now } }],
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Error: MONGODB_URI not set");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const existing = await User.findOne({ username: "heimdall" });
  if (existing) {
    console.log("Admin user 'heimdall' already exists — resetting password to 'changeme'");
    existing.passwordHash = await bcrypt.hash("changeme", 10);
    await existing.save();
  } else {
    await User.create({
      username: "heimdall",
      passwordHash: await bcrypt.hash("changeme", 10),
      role: "admin",
      apiKeys: [],
    });
    console.log("Admin user created");
  }

  console.log("\n   Username: heimdall");
  console.log("   Password: changeme");
  console.log("   Change the password immediately after first login!\n");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
