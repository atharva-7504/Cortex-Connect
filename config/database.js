const mongoose = require("mongoose");

const isProduction = process.env.NODE_ENV === "production";
const configuredMongoUri = String(process.env.MONGODB_URI || "").trim();
const localMongoUri = "mongodb://127.0.0.1:27017/cortex-connect";

if (isProduction && !configuredMongoUri) {
  throw new Error("MONGODB_URI is required when NODE_ENV=production.");
}

const mongoUri = isProduction && configuredMongoUri ? configuredMongoUri : localMongoUri;

const connectDatabase = async () => {
  await mongoose.connect(mongoUri);
};

module.exports = {
  connectDatabase,
  mongoUri
};
