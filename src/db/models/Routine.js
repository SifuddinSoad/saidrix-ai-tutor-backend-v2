// ===========================================
// Routine Model
// Stores a generated day-by-day study schedule for a course (or
// courses). This is a STATIC stored plan — there is no background
// scheduler/cron that fires reminders. The client renders `days[]`.
// ===========================================

import mongoose from "mongoose";

const Schema = mongoose.Schema;

// --- Location inside a course (only for `lecture` items) ---

const locationSchema = new Schema(
  {
    chapter_index: { type: Number, required: true },
    module_index: { type: Number, required: true },
    sub_module_index: { type: Number, required: true },
    topic_index: { type: Number, required: true },
  },
  { _id: false }
);

// --- A single scheduled item within a day ---

// Each scheduled task gets its own stable ID so the UI can mark it
// done / delete it without depending on array index. `done` + `doneAt`
// persist progress across sessions (no more localStorage).
const itemSchema = new Schema(
  {
    taskId: {
      type: String,
      required: true,
      // Unique-per-routine; not globally unique.
    },
    type: {
      type: String,
      enum: ["lecture", "project_deadline"],
      required: true,
    },
    title: { type: String, required: true },
    courseId: { type: String, default: "" },
    // Present for `lecture` items
    location: { type: locationSchema, default: undefined },
    // Present for `project_deadline` items
    projectId: { type: String, default: undefined },
    estimated_minutes: { type: Number, default: 0 },

    // Progress
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
  },
  { _id: false }
);

// --- One calendar day ---

const daySchema = new Schema(
  {
    date: { type: Date, required: true },
    items: { type: [itemSchema], default: [] },
  },
  { _id: false }
);

const routineSchema = new Schema(
  {
    // Unique routine identifier
    routineId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    title: { type: String, default: "Study Routine" },

    // Courses this routine schedules
    courseIds: { type: [String], default: [] },

    // Inputs used to build the plan
    startDate: { type: Date, required: true },
    dailyHours: { type: Number, default: 1 },
    // Target completion window in days (LLM uses this as the upper
    // bound when packing topics across days). 0 = no constraint.
    totalDays: { type: Number, default: 0 },
    // Free-text reading-time hint, e.g. "evening 8-10pm", "after Fajr".
    // Stored verbatim for display; not parsed.
    readingTime: { type: String, default: "" },

    // The generated schedule
    days: { type: [daySchema], default: [] },

    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },

    // DB infrastructure
    sessionId: { type: String, index: true },
    userId: { type: String, default: "default", index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

// --- Index for listing a user's routines by recency ---
routineSchema.index({ userId: 1, createdAt: -1 });

const Routine = mongoose.model("Routine", routineSchema);
export default Routine;
