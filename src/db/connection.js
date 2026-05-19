// ===========================================
// MongoDB Connection
// Connects with bounded retry + backoff so a brief
// DB outage at boot doesn't hard-kill the process on
// the first failed attempt. Runtime drops are surfaced
// via connection events; mongoose auto-reconnects.
// ===========================================

import mongoose from "mongoose";
import logger from "../utils/logger.js";

const MAX_ATTEMPTS = Number(process.env.MONGODB_MAX_RETRIES) || 5;
const BASE_DELAY_MS = 2000;

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// --- Connect to MongoDB (retry with exponential backoff) ---

export async function connectDB() {
  const uri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/saidrix-ai-tutor";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
      });
      logger.info("MongoDB connected successfully");
      return;
    } catch (err) {
      const last = attempt === MAX_ATTEMPTS;
      logger.error(
        `MongoDB connection failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}`
      );
      if (last) {
        // Exhausted retries — let the caller decide (index.js exits).
        throw err;
      }
      const wait = BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(`Retrying MongoDB connection in ${wait}ms...`);
      await delay(wait);
    }
  }
}

// --- Connection Event Handlers ---

mongoose.connection.on("error", (err) => {
  logger.error("MongoDB connection error:", err.message);
});

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected — mongoose will attempt to reconnect");
});

mongoose.connection.on("reconnected", () => {
  logger.info("MongoDB reconnected");
});

export default connectDB;
