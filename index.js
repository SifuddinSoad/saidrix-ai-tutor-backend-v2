// ===========================================
// Server Entry Point
// Connects MongoDB, starts HTTP + WebSocket
// ===========================================

import "dotenv/config";
import { createServer } from "http";
import app from "./src/app.js";
import { connectDB } from "./src/db/connection.js";
import { setupChatWebSocket } from "./src/routes/chat.ws.js";
import { sessionCache } from "./src/agents/chat/memory.js";
import { registerProcessHandlers } from "./src/errors/index.js";
import logger from "./src/utils/logger.js";
import mongoose from "mongoose";

const PORT = process.env.PORT || 3000;

// --- Start Server ---

async function start() {
  // Connect to MongoDB
  await connectDB();

  // Create HTTP server (needed for WebSocket attachment)
  const server = createServer(app);

  // Attach WebSocket server at /ws/chat
  setupChatWebSocket(server);

  // Start session cache eviction timer
  sessionCache.startEvictionTimer();

  // Process-level safety net + graceful shutdown
  registerProcessHandlers(server, {
    onShutdown: async () => {
      try {
        sessionCache.stopEvictionTimer?.();
      } catch { /* noop */ }
      await mongoose.connection.close().catch(() => {});
    },
  });

  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      logger.error(`Port ${PORT} is already in use`);
    } else {
      logger.error("HTTP server error:", err?.message || err);
    }
    process.exit(1);
  });

  // Start listening
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`REST API: http://localhost:${PORT}/api/chat`);
    logger.info(`WebSocket: ws://localhost:${PORT}/ws/chat`);
  });
}

start().catch((err) => {
  logger.error("Server failed to start:", err?.stack || err?.message || err);
  process.exit(1);
});
