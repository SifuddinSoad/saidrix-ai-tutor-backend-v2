// ===========================================
// Project Model
// Stores hands-on practice projects generated for a course.
// One Project document == one project (a course can have several).
//
// `unlock` records WHICH part of the course must be learned before
// the project makes sense. It is DESCRIPTIVE METADATA only — nothing
// in this codebase enforces it yet (lock/unlock enforcement is a
// later, separate piece of work).
// ===========================================

import mongoose from "mongoose";

const Schema = mongoose.Schema;

// --- Unlock criteria (descriptive, not enforced) ---
// Points at the latest course location whose knowledge the project
// depends on. Indices map onto Course > chapters[] > modules[] >
// sub_modules[] > topics[].

const unlockSchema = new Schema(
  {
    chapter_index: { type: Number, default: 0 },
    module_index: { type: Number, default: 0 },
    topic_indices: { type: [Number], default: [] },
    description: { type: String, default: "" },
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    // Unique project identifier
    projectId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // The course this project belongs to
    courseId: {
      type: String,
      required: true,
    },

    // How this project was created
    source: {
      type: String,
      enum: ["auto", "chat"],
      default: "auto",
    },

    // Project content (LLM-generated)
    project_name: { type: String, required: true },
    description: { type: String, default: "" },
    requirements: { type: [String], default: [] },
    skills_practiced: { type: [String], default: [] },

    // Descriptive unlock criteria (NOT enforced)
    unlock: { type: unlockSchema, default: () => ({}) },

    // Effort & deadline
    estimated_effort_hours: { type: Number, default: 0 },
    // Absolute deadline, computed from a relative `deadline_days` the
    // agent returns (null when the agent gives no deadline).
    deadline: { type: Date, default: null },

    // Stored status (NOT enforced — see file header)
    status: {
      type: String,
      enum: ["locked", "unlocked", "completed"],
      default: "locked",
    },

    // DB infrastructure (not part of the LLM output)
    sessionId: { type: String, index: true },
    userId: { type: String, default: "default", index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  },
);

// --- Indexes for listing ---
projectSchema.index({ courseId: 1 });
projectSchema.index({ userId: 1, createdAt: -1 });

const Project = mongoose.model("Project", projectSchema);
export default Project;
