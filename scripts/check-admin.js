const mongoose = require("mongoose");
const fs = require("fs");

for (const line of fs.readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const user = await db.collection("users").findOne({ username: "heimdall" });
  if (!user) {
    console.log("NO USER FOUND");
    process.exit(1);
  }
  console.log("User found:", JSON.stringify({ username: user.username, role: user.role }, null, 2));
  await mongoose.disconnect();
})();
