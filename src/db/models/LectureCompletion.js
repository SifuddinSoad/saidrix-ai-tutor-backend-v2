// ===========================================
// LectureCompletion Model
// One row per (user, course, topic-location) the user finished.
// The unique compound index makes re-completing idempotent so XP
// and streaks can never be double-counted.
// location indices map onto Course > chapters[] > modules[] >
// sub_modules[] > topics[].
// ===========================================

import mongoose from "mongoose";

const Schema = mongoose.Schema;

const locationSchema = new Schema(
  {
    chapter: { type: Number, required: true },
    module: { type: Number, required: true },
    sub_module: { type: Number, required: true },
    topic: { type: Number, required: true },
  },
  { _id: false }
);

const lectureCompletionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    location: { type: locationSchema, required: true },
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Idempotency: one completion per exact topic location per user.
lectureCompletionSchema.index(
  {
    userId: 1,
    courseId: 1,
    "location.chapter": 1,
    "location.module": 1,
    "location.sub_module": 1,
    "location.topic": 1,
  },
  { unique: true }
);

const LectureCompletion = mongoose.model(
  "LectureCompletion",
  lectureCompletionSchema
);
export default LectureCompletion;
