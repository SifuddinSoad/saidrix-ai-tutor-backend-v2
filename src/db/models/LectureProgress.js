// ===========================================
// LectureProgress Model
// Cross-session checkpoint of how far a user has played through a
// given lecture. VoiceSession also stores currentBlockIndex, but it
// disappears with the session; this doc survives so we can resume.
// One doc per (userId, lectureId).
// ===========================================

import mongoose from "mongoose";

const lectureProgressSchema = new mongoose.Schema(
  {
    userId:        { type: String, required: true, index: true },
    lectureId:     { type: String, required: true, index: true },

    // -1 means "from the start"; any non-negative value is the last
    // block the player finished narrating.
    lastBlockIndex: { type: Number, default: -1 },
    totalBlocks:    { type: Number, default: 0 },

    completed:    { type: Boolean, default: false, index: true },
    completedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

lectureProgressSchema.index({ userId: 1, lectureId: 1 }, { unique: true });

const LectureProgress = mongoose.model("LectureProgress", lectureProgressSchema);
export default LectureProgress;
