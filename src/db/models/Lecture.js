// ===========================================
// Lecture Model
// Stores generated comprehensive lectures
// Content is an array of typed blocks (text/code/image/svg/json/etc.)
// ===========================================

import mongoose from "mongoose";

const Schema = mongoose.Schema;

// --- Lecture Block Schema (Mixed type since blocks vary) ---
// Each block has a `type` field and type-specific fields.
// We use Mixed to allow flexible block shapes without strict schema.

const blockSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "heading",
        "text",
        "code",
        "image",
        "svg",
        "json",
        "list",
        "table",
        "quote",
        "callout",
        "divider",
      ],
    },
    // Generic content field — exact shape depends on block type
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

// ===========================================
// Main Lecture Schema
// ===========================================

const lectureSchema = new Schema(
  {
    // Unique lecture identifier
    lectureId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Link back to the parent course
    courseId: {
      type: String,
      required: true,
      index: true,
    },

    // Position in the course hierarchy (which topic this lecture belongs to)
    location: {
      chapter_index: { type: Number, required: true },
      module_index: { type: Number, required: true },
      sub_module_index: { type: Number, required: true },
      topic_index: { type: Number, required: true },
    },

    // Snapshot of the topic info at generation time (for reference)
    topic_name: { type: String, required: true },
    topic_description: { type: String, default: "" },

    // Lecture metadata
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    estimated_duration_minutes: { type: Number, default: 0 },

    // The lecture content — array of typed blocks
    blocks: {
      type: [blockSchema],
      default: [],
    },

    // Sources used to build this lecture
    sources: {
      type: [String],
      default: [],
    },

    // User ownership
    userId: {
      type: String,
      default: "default",
      index: true,
    },

    // Generation metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// --- Indexes ---
lectureSchema.index({ courseId: 1, createdAt: -1 });
lectureSchema.index(
  {
    courseId: 1,
    "location.chapter_index": 1,
    "location.module_index": 1,
    "location.sub_module_index": 1,
    "location.topic_index": 1,
  },
  { unique: true } // One lecture per topic
);

// --- Export ---

const Lecture = mongoose.model("Lecture", lectureSchema);
export default Lecture;
