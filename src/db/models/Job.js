// ===========================================
// Job Model
// Tracks long-running background tasks
// Used for async lecture generation
// ===========================================

import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    // Unique job identifier
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Type of job (e.g., "lecture", "course", etc.)
    type: {
      type: String,
      required: true,
      index: true,
    },

    // Current execution status
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "cancelled"],
      default: "pending",
      index: true,
    },

    // Optional progress info (0–100 or descriptive string)
    progress: {
      percent: { type: Number, default: 0 },
      message: { type: String, default: "" },
    },

    // Input parameters used to start the job
    input: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Result data (populated on success)
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Error message (populated on failure)
    error: {
      type: String,
      default: null,
    },

    // Linked entity IDs (e.g., lectureId after lecture completes)
    relatedIds: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // User who owns this job
    userId: {
      type: String,
      default: "default",
      index: true,
    },

    // Timestamps for tracking duration
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// --- Compound index for listing jobs ---
jobSchema.index({ userId: 1, createdAt: -1 });

// --- Export ---

const Job = mongoose.model("Job", jobSchema);
export default Job;
