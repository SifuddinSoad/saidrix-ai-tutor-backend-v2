// ===========================================
// Session Model
// Stores chat session metadata
// Each session contains multiple messages
// ===========================================

import mongoose from "mongoose";

// --- Session Schema ---

const sessionSchema = new mongoose.Schema(
  {
    // Unique session identifier (UUID)
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // User who owns this session
    userId: {
      type: String,
      default: "default",
      index: true,
    },

    // Session title (auto-generated from first message)
    title: {
      type: String,
      default: "New Chat",
    },

    // Flexible metadata field (model used, agent config, etc.)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Timestamp of the last message in this session
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // Auto-add createdAt and updatedAt fields
    timestamps: true,
  }
);

// --- Compound Index ---
// For listing user sessions sorted by most recent activity

sessionSchema.index({ userId: 1, lastMessageAt: -1 });

// --- Export Model ---

const Session = mongoose.model("Session", sessionSchema);
export default Session;
