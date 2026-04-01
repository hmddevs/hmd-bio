const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI environment variable is required");
  await mongoose.connect(uri);
  console.log("Connected to MongoDB Atlas");

  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  console.log("Existing collections:", collections.map(c => c.name));

  // Create indexes
  await db.collection("links").createIndex({ keyword: 1 }, { unique: true });
  await db.collection("clicks").createIndex({ keyword: 1, createdAt: -1 });
  await db.collection("clicks").createIndex({ countryCode: 1 });
  await db.collection("options").createIndex({ key: 1 }, { unique: true });
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  console.log("Indexes created");

  // Seed admin user
  const hash = await bcrypt.hash("changeme", 10);
  await db.collection("users").updateOne(
    { username: "heimdall" },
    {
      $setOnInsert: {
        username: "heimdall",
        passwordHash: hash,
        role: "admin",
        apiKeys: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  console.log("Admin user 'heimdall' seeded (password: changeme)");

  await mongoose.disconnect();
  console.log("Done!");
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
