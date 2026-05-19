// ===========================================
// Message Model
// Stores individual chat messages
// Linked to a Session via sessionId
// ===========================================

import mongoose from "mongoose";

// --- Message Schema ---

const messageSchema = new mongoose.Schema(
  {
    // Foreign key to Session
    sessionId: {
      type: String,
      required: true,
      index: true,
    },

    // Message role: who sent this message
    role: {
      type: String,
      required: true,
      enum: ["user", "assistant", "system", "tool"],
    },

    // The actual message text content
    content: {
      type: String,
      default: "",
    },

    // Tool calls made by assistant (array of tool call objects)
    toolCalls: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },

    // Tool call ID (for tool response messages)
    toolCallId: {
      type: String,
      default: undefined,
    },

    // Tool name (for tool response messages)
    name: {
      type: String,
      default: undefined,
    },

    // Structured clarifying-question prompts (the `ask` block UI).
    prompts: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },

    // Course refs attached after a successful create_course call.
    courseRefs: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },

    // Course proposal (the `proposal` block UI) — { intro, courses[] }.
    proposal: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },

    // Stream messageId carried across so a later PATCH can locate this doc.
    messageId: {
      type: String,
      default: undefined,
    },

    // Flexible metadata (token counts, model used, latency, etc.)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    // Auto-add createdAt and updatedAt fields
    timestamps: true,
  }
);

// --- Compound Index ---
// For fetching conversation history in chronological order

messageSchema.index({ sessionId: 1, createdAt: 1 });

// --- Export Model ---

const Message = mongoose.model("Message", messageSchema);
export default Message;
