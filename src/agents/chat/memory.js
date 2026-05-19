// ===========================================
// Session Cache & Memory Manager
// Two-tier memory: in-memory Map + MongoDB
// Fast reads from cache, persistent writes to DB
// ===========================================

import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import Message from "../../db/models/Message.js";
import Session from "../../db/models/Session.js";
import logger from "../../utils/logger.js";

// ===========================================
// Message Conversion Helpers
// Convert between MongoDB docs and LangChain messages
// ===========================================

// --- MongoDB doc -> LangChain Message ---

function docToLangChainMessage(doc) {
  switch (doc.role) {
    case "user":
      return new HumanMessage({ content: doc.content });

    case "assistant": {
      const msgData = { content: doc.content || "" };
      if (doc.toolCalls && doc.toolCalls.length > 0) {
        msgData.tool_calls = doc.toolCalls;
      }
      const additional = {};
      if (doc.prompts && doc.prompts.length > 0) additional.prompts = doc.prompts;
      if (doc.courseRefs && doc.courseRefs.length > 0) additional.courseRefs = doc.courseRefs;
      if (doc.proposal && Array.isArray(doc.proposal.courses) && doc.proposal.courses.length > 0) {
        additional.proposal = doc.proposal;
      }
      if (Object.keys(additional).length > 0) msgData.additional_kwargs = additional;
      return new AIMessage(msgData);
    }

    case "system":
      return new SystemMessage({ content: doc.content });

    case "tool":
      return new ToolMessage({
        content: doc.content,
        tool_call_id: doc.toolCallId,
        name: doc.name,
      });

    default:
      return new HumanMessage({ content: doc.content });
  }
}

// --- LangChain Message -> MongoDB doc fields ---

function langChainMessageToDoc(message, sessionId) {
  const doc = { sessionId, content: "" };

  // Determine role from message type
  if (message instanceof HumanMessage) {
    doc.role = "user";
    doc.content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  } else if (message instanceof AIMessage) {
    doc.role = "assistant";
    doc.content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    // Save tool calls if present
    if (message.tool_calls && message.tool_calls.length > 0) {
      doc.toolCalls = message.tool_calls;
    }
    // Preserve structured clarifying-question prompts (set by the agent
    // pipeline in additional_kwargs.prompts after extractAskBlocks).
    const prompts = message.additional_kwargs?.prompts;
    if (Array.isArray(prompts) && prompts.length > 0) {
      doc.prompts = prompts;
    }
    // Preserve course refs attached after a successful create_course call.
    const courseRefs = message.additional_kwargs?.courseRefs;
    if (Array.isArray(courseRefs) && courseRefs.length > 0) {
      doc.courseRefs = courseRefs;
    }
    // Preserve the course proposal block (post-assessment).
    const proposal = message.additional_kwargs?.proposal;
    if (proposal && Array.isArray(proposal.courses) && proposal.courses.length > 0) {
      doc.proposal = proposal;
    }
    // Carry the stream's messageId across to the DB record so a later
    // PATCH can locate this message by its stream id.
    if (message.additional_kwargs?.messageId) {
      doc.messageId = message.additional_kwargs.messageId;
    }
  } else if (message instanceof SystemMessage) {
    doc.role = "system";
    doc.content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
  } else if (message instanceof ToolMessage) {
    doc.role = "tool";
    doc.content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    doc.toolCallId = message.tool_call_id;
    doc.name = message.name;
  }

  return doc;
}

// ===========================================
// SessionCache Class
// In-memory cache with MongoDB persistence
// ===========================================

export class SessionCache {
  constructor() {
    // Map<sessionId, { messages: BaseMessage[], lastAccess: Date }>
    this.cache = new Map();

    // Eviction timer reference
    this.evictionTimer = null;

    // Evict sessions inactive for 30 minutes
    this.evictionTimeout = 30 * 60 * 1000;
  }

  // --- Get Messages for a Session ---
  // Returns cached messages or loads from MongoDB

  async get(sessionId) {
    // Check cache first
    if (this.cache.has(sessionId)) {
      const entry = this.cache.get(sessionId);
      entry.lastAccess = new Date();
      return entry.messages;
    }

    // Cache miss — load from MongoDB
    const messages = await this.loadFromDB(sessionId);
    this.cache.set(sessionId, {
      messages,
      lastAccess: new Date(),
    });

    return messages;
  }

  // --- Append a Message ---
  // Adds to cache AND writes to MongoDB

  async append(sessionId, message) {
    // Ensure session exists in cache
    if (!this.cache.has(sessionId)) {
      await this.get(sessionId);
    }

    const entry = this.cache.get(sessionId);
    entry.messages.push(message);
    entry.lastAccess = new Date();

    // Persist to MongoDB
    await this.saveToDB(sessionId, message);

    // Update session's lastMessageAt
    await Session.findOneAndUpdate(
      { sessionId },
      { lastMessageAt: new Date() }
    );
  }

  // --- Load Messages from MongoDB ---

  async loadFromDB(sessionId) {
    try {
      const docs = await Message.find({ sessionId })
        .sort({ createdAt: 1 })
        .lean();

      logger.info(`[Memory] Loaded ${docs.length} messages from DB for session: ${sessionId}`);
      return docs.map(docToLangChainMessage);
    } catch (err) {
      logger.error(`[Memory] Failed to load from DB:`, err.message);
      return [];
    }
  }

  // --- Save a Single Message to MongoDB ---

  async saveToDB(sessionId, message) {
    try {
      const doc = langChainMessageToDoc(message, sessionId);
      await Message.create(doc);
    } catch (err) {
      logger.error(`[Memory] Failed to save to DB:`, err.message);
    }
  }

  // --- Evict Inactive Sessions from Cache ---

  evict() {
    const now = Date.now();
    let evictedCount = 0;

    for (const [sessionId, entry] of this.cache.entries()) {
      if (now - entry.lastAccess.getTime() > this.evictionTimeout) {
        this.cache.delete(sessionId);
        evictedCount++;
      }
    }

    if (evictedCount > 0) {
      logger.info(`[Memory] Evicted ${evictedCount} inactive sessions from cache`);
    }
  }

  // --- Start Eviction Timer ---
  // Runs eviction check every 10 minutes

  startEvictionTimer() {
    this.evictionTimer = setInterval(() => this.evict(), 10 * 60 * 1000);
    logger.info("[Memory] Session cache eviction timer started (10min interval)");
  }

  // --- Stop Eviction Timer ---

  stopEvictionTimer() {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  // --- Clear a Specific Session from Cache ---

  clearSession(sessionId) {
    this.cache.delete(sessionId);
  }

  // --- Get Cache Stats ---

  getStats() {
    return {
      activeSessions: this.cache.size,
      sessions: Array.from(this.cache.entries()).map(([id, entry]) => ({
        sessionId: id,
        messageCount: entry.messages.length,
        lastAccess: entry.lastAccess,
      })),
    };
  }
}

// --- Singleton Instance ---

export const sessionCache = new SessionCache();
export default sessionCache;
