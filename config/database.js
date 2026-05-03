const mongoose = require("mongoose");

const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/cortex-connect";

const connectDatabase = async () => {
  await mongoose.connect(mongoUri);
};

module.exports = {
  connectDatabase,
  mongoUri
};
