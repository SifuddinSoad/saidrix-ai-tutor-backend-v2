// ===========================================
// EnrichedSegment Model
// Stores enriched (audio-tagged) speech segments
// derived from a Lecture, ready for TTS playback.
// Voice worker reads these segments one-by-one.
// ===========================================

import mongoose from "mongoose";

const enrichedSegmentSchema = new mongoose.Schema(
  {
    // Unique segment identifier
    segmentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Parent lecture (segments cached per-lecture so multiple voice
    // sessions can reuse the same enrichment — saves cost)
    lectureId: {
      type: String,
      required: true,
      index: true,
    },

    // Order within the lecture's speech plan (0, 1, 2, ...)
    order: {
      type: Number,
      required: true,
    },

    // Which lecture block this segment corresponds to
    //   -2 = title intro
    //   -1 = summary intro
    //    0+ = lecture.blocks[blockIndex]
    blockIndex: {
      type: Number,
      required: true,
    },

    // Original speech text (before enrichment) — for diff/debug
    originalText: {
      type: String,
      default: "",
    },

    // Enriched speech text with [emotion] tags — what TTS will speak
    enrichedText: {
      type: String,
      required: true,
    },

    // Status of this segment
    status: {
      type: String,
      enum: ["pending", "ready", "failed"],
      default: "ready",
      index: true,
    },

    // If failed, the reason
    error: { type: String, default: null },

    // Metadata (model used, enrichment time, etc.)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

// --- Compound index for sequential fetch by lecture ---
enrichedSegmentSchema.index({ lectureId: 1, order: 1 }, { unique: true });

const EnrichedSegment = mongoose.model("EnrichedSegment", enrichedSegmentSchema);
export default EnrichedSegment;
