// ===========================================
// Course Model
// Stores generated learning courses
// Hierarchy: Course > Chapters > Modules > Sub-modules > Topics
// ===========================================

import mongoose from "mongoose";

const Schema = mongoose.Schema;

// --- Topic Sub-Schema (Leaf) ---
// description = lecture-generation instruction (not actual content)

const topicSchema = new Schema(
  {
    topic_name: { type: String, required: true },
    description: { type: String, required: true },
  },
  { _id: false }
);

// --- Sub-module Sub-Schema ---

const subModuleSchema = new Schema(
  {
    sub_module_name: { type: String, required: true },
    topics: { type: [topicSchema], default: [] },
  },
  { _id: false }
);

// --- Module Sub-Schema ---

const moduleSchema = new Schema(
  {
    module_name: { type: String, required: true },
    sub_modules: { type: [subModuleSchema], default: [] },
  },
  { _id: false }
);

// --- Chapter Sub-Schema ---

const chapterSchema = new Schema(
  {
    chapter_name: { type: String, required: true },
    modules: { type: [moduleSchema], default: [] },
  },
  { _id: false }
);

// ===========================================
// Main Course Schema
// ===========================================

const courseSchema = new Schema(
  {
    // Unique course identifier
    courseId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Course content (LLM-generated, matches user-specified output format)
    course_title: { type: String, required: true },
    course_description: { type: String, default: "" },
    chapters: { type: [chapterSchema], default: [] },

    // DB infrastructure (not part of the LLM output)
    sessionId: { type: String, index: true },
    userId: { type: String, default: "default", index: true },
  },
  {
    timestamps: true,
  }
);

// --- Index for listing user's courses by recency ---
courseSchema.index({ userId: 1, createdAt: -1 });

// --- Export ---

const Course = mongoose.model("Course", courseSchema);
export default Course;
