// ===========================================
// ToolCallLog Model
// Persists every tool invocation that the chat agent makes,
// so the frontend AgentLog can hydrate from history.
// ===========================================

import mongoose from "mongoose";

const toolCallLogSchema = new mongoose.Schema(
  {
    toolCallId: { type: String, required: true, unique: true, index: true },
    sessionId:  { type: String, required: true, index: true },
    messageId:  { type: String, default: null, index: true },

    toolName:   { type: String, required: true },
    status:     {
      type: String,
      enum: ["running", "complete", "error"],
      default: "complete",
    },

    input:      { type: mongoose.Schema.Types.Mixed, default: null },
    output:     { type: String, default: "" },
    durationMs: { type: Number, default: 0 },

    startedAt:   { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

toolCallLogSchema.index({ sessionId: 1, startedAt: -1 });

const ToolCallLog = mongoose.model("ToolCallLog", toolCallLogSchema);
export default ToolCallLog;
