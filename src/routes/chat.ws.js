// ===========================================
// Chat WebSocket Handler
// Real-time streaming chat over WebSocket
// Connects clients to the LangGraph chat agent
// ===========================================

import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";
import { invokeChatAgent } from "../agents/chat/graph.js";
import Session from "../db/models/Session.js";
import { verifyAccessToken } from "../services/token.service.js";
import { resolveAccountStatus, isActiveStatus } from "../utils/accountStatus.js";
import logger from "../utils/logger.js";

// --- Active Connections Registry ---
// Map<sessionId, Set<WebSocket>> — supports multiple tabs per session

const connections = new Map();

// ===========================================
// WebSocket Setup
// ===========================================

// --- Attach WebSocket Server to HTTP Server ---

export function setupChatWebSocket(server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws/chat",
  });

  logger.info("[WebSocket] Chat WebSocket server started at /ws/chat");

  // --- Server-level errors (bind failures, etc.) ---
  wss.on("error", (err) => {
    logger.error("[WebSocket] Server error:", err?.message || err);
  });

  // --- Heartbeat: drop sockets that stop responding to pings ---
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* noop */
      }
    }
  }, 30000);
  heartbeat.unref?.();
  wss.on("close", () => clearInterval(heartbeat));

  // --- Handle New Connections ---

  wss.on("connection", async (ws, req) => {
    let currentSessionId = null;

    // --- Authenticate + authorize the socket ---
    // Browsers can't set headers on a WS handshake, so the SPA passes the
    // short-lived access token as a query param. Reject unauthenticated
    // sockets immediately (1008 = policy violation). We also verify the
    // account is still active (live DB check + lazy trial expiry) so an
    // expired/lapsed user can't keep chatting on a stale token.
    try {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      if (!token) throw new Error("missing token");
      const payload = verifyAccessToken(token);
      const acct = await resolveAccountStatus(payload.sub);
      if (!acct || !isActiveStatus(acct.status)) {
        throw new Error("inactive account");
      }
      ws.userId = payload.sub;
    } catch {
      logger.warn("[WebSocket] Rejected unauthorized connection");
      sendJSON(ws, { type: "error", error: "Unauthorized" });
      try {
        ws.close(1008, "Unauthorized");
      } catch {
        /* noop */
      }
      return;
    }

    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    logger.info("[WebSocket] New client connected");

    // --- Handle Incoming Messages ---

    ws.on("message", async (data) => {
      // Parse step — a bad frame is a client error, not a server fault.
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        sendJSON(ws, {
          type: "error",
          error: "Invalid message format. Expected JSON.",
        });
        return;
      }

      // Handler step — operational/DB errors are reported distinctly so a
      // failed init isn't mislabeled as a parse error.
      try {
        await handleMessage(ws, message, (id) => {
          currentSessionId = id;
        });
      } catch (err) {
        logger.error(
          "[WebSocket] Message handler failed:",
          err?.message || err,
        );
        sendJSON(ws, {
          type: "error",
          error: "Server failed to process the message. Please retry.",
        });
      }
    });

    // --- Handle Connection Close ---

    ws.on("close", () => {
      if (currentSessionId && connections.has(currentSessionId)) {
        const sessionConns = connections.get(currentSessionId);
        sessionConns.delete(ws);
        if (sessionConns.size === 0) {
          connections.delete(currentSessionId);
        }
      }
      logger.info("[WebSocket] Client disconnected");
    });

    // --- Handle Errors ---

    ws.on("error", (err) => {
      logger.error("[WebSocket] Connection error:", err?.message || err);
    });
  });

  return wss;
}

// ===========================================
// Message Handlers
// ===========================================

// --- Route Incoming Messages by Type ---

async function handleMessage(ws, message, setSessionId) {
  const { type } = message;

  switch (type) {
    // --- Initialize/Join a Session ---
    case "init": {
      const sessionId = message.sessionId || randomUUID();
      const userId = ws.userId;
      logger.debug(`[WebSocket] init session: ${sessionId}`);

      // Create session in DB if it doesn't exist; if it does, it must
      // belong to this authenticated user.
      const existing = await Session.findOne({ sessionId });
      if (existing) {
        if (existing.userId !== userId) {
          sendJSON(ws, { type: "error", error: "Session not found" });
          return;
        }
      } else {
        await Session.create({
          sessionId,
          userId,
          title: message.title || "New Chat",
        });
        logger.info(`[WebSocket] Created new session: ${sessionId}`);
      }

      // Register connection
      if (!connections.has(sessionId)) {
        connections.set(sessionId, new Set());
      }
      connections.get(sessionId).add(ws);
      setSessionId(sessionId);

      // Confirm initialization
      sendJSON(ws, {
        type: "init_ok",
        sessionId,
      });

      logger.info(`[WebSocket] Client joined session: ${sessionId}`);
      break;
    }

    // --- Handle Chat Message ---
    case "message": {
      const { content, sessionId } = message;

      // Validate required fields
      if (!content || !sessionId) {
        sendJSON(ws, {
          type: "error",
          error: "Missing 'content' or 'sessionId' field",
        });
        return;
      }

      // The session must exist and belong to this authenticated user.
      const owned = await Session.findOne({ sessionId });
      if (!owned || owned.userId !== ws.userId) {
        sendJSON(ws, { type: "error", error: "Session not found" });
        return;
      }

      // Generate a unique message ID for this response
      const messageId = randomUUID();

      // Reset the per-connection cancel flag for this new turn
      ws._cancelStream = false;
      ws._activeMessageId = messageId;

      // Notify client that processing has started
      sendJSON(ws, {
        type: "start",
        messageId,
        sessionId,
      });

      // Stream the agent's response — pass the stream messageId so the
      // assistant DB record is tagged with the same identifier the client
      // already has, enabling later PATCH lookups.
      let acc = "";
      try {
        for await (const chunk of invokeChatAgent(sessionId, content, {
          messageId,
          userId: ws.userId,
        })) {
          // Client disconnected mid-stream
          if (ws.readyState !== ws.OPEN) {
            logger.warn("[WebSocket] Client disconnected during streaming");
            break;
          }

          // User pressed Stop — end the turn early with what we have
          if (ws._cancelStream) {
            logger.info(`[WebSocket] Stream cancelled by user (${messageId})`);
            sendJSON(ws, {
              type: "end",
              content: acc,
              cancelled: true,
              messageId,
              sessionId,
            });
            break;
          }

          if (chunk.type === "token") acc += chunk.content || "";

          // Forward each chunk to the client
          sendJSON(ws, {
            ...chunk,
            messageId,
            sessionId,
          });
        }
      } catch (err) {
        logger.error("[WebSocket] Streaming error:", err.message);
        sendJSON(ws, {
          type: "error",
          error: err.message,
          messageId,
          sessionId,
        });
      } finally {
        ws._activeMessageId = null;
      }

      break;
    }

    // --- Stop the in-flight stream for this connection ---
    case "stop": {
      ws._cancelStream = true;
      break;
    }

    // --- Ping/Pong for Keep-Alive ---
    case "ping": {
      sendJSON(ws, { type: "pong" });
      break;
    }

    // --- Unknown Message Type ---
    default: {
      sendJSON(ws, {
        type: "error",
        error: `Unknown message type: "${type}"`,
      });
    }
  }
}

// ===========================================
// Utility Functions
// ===========================================

// --- Send JSON to WebSocket Client ---

function sendJSON(ws, data) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(data));
  } catch (err) {
    logger.error("[WebSocket] Failed to send frame:", err?.message || err);
  }
}

export default { setupChatWebSocket };
