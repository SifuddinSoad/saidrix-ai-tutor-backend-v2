// ===========================================
// VoiceSession Model
// Tracks lecture playback sessions over LiveKit
// ===========================================

import mongoose from "mongoose";

const voiceSessionSchema = new mongoose.Schema(
  {
    // Unique session identifier
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // The lecture being played
    lectureId: {
      type: String,
      required: true,
      index: true,
    },

    // LiveKit room name (derived from sessionId)
    roomName: {
      type: String,
      required: true,
      unique: true,
    },

    // Session lifecycle state
    state: {
      type: String,
      enum: ["pending", "active", "completed", "failed", "ended"],
      default: "pending",
      index: true,
    },

    // Current playback position (for resume support)
    currentBlockIndex: { type: Number, default: 0 },
    currentCharOffset: { type: Number, default: 0 },

    // Has the agent worker joined the room?
    agentJoined: { type: Boolean, default: false },

    // Voice configuration
    voiceId: { type: String, default: "" },
    model: { type: String, default: "" },

    // User ownership
    userId: { type: String, default: "default", index: true },

    // Lifecycle timestamps
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    // Error message if state === "failed"
    error: { type: String, default: null },

    // Flexible metadata
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    // --- Phase 2: Q&A transcript history ---
    transcripts: {
      type: [
        {
          role: { type: String, enum: ["student", "assistant"], required: true },
          text: { type: String, required: true },
          blockIndex: { type: Number, default: -1 },
          timestamp: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    qaCount: { type: Number, default: 0 },
    lastInteractionAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// --- Indexes ---
voiceSessionSchema.index({ userId: 1, createdAt: -1 });
voiceSessionSchema.index({ lectureId: 1, state: 1 });

const VoiceSession = mongoose.model("VoiceSession", voiceSessionSchema);
export default VoiceSession;
