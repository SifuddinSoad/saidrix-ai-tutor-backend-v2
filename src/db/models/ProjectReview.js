// ===========================================
// ProjectReview Model
// One document per submission. Re-submission of the same project
// creates a NEW review (history preserved on Project.submissionHistory).
// ===========================================

import mongoose from "mongoose";

const Schema = mongoose.Schema;

const issueSchema = new Schema(
  {
    issueId: { type: String, required: true },
    severity: {
      type: String,
      enum: ["critical", "warning", "info"],
      required: true,
    },
    category: {
      type: String,
      enum: ["requirements", "codeQuality", "bugs", "syntax"],
      required: true,
    },
    filePath: { type: String, required: true },
    lineStart: { type: Number, default: 1 },
    lineEnd: { type: Number, default: 1 },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    suggestion: { type: String, default: "" },
    codeSnippet: { type: String, default: "" },
  },
  { _id: false }
);

const scoresSchema = new Schema(
  {
    requirements: { type: Number, default: 100 },
    codeQuality: { type: Number, default: 100 },
    bugs: { type: Number, default: 100 },
    syntax: { type: Number, default: 100 },
  },
  { _id: false }
);

const fileStatsSchema = new Schema(
  {
    totalFiles: { type: Number, default: 0 },
    reviewedFiles: { type: Number, default: 0 },
    skippedFiles: { type: Number, default: 0 },
    totalLines: { type: Number, default: 0 },
  },
  { _id: false }
);

const reviewedFileSchema = new Schema(
  {
    path: { type: String, required: true },
    lineCount: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    // Content is kept so the details page can render line-by-line code
    // without a second fetch. Truncated to MAX_FILE_BYTES upstream.
    content: { type: String, default: "" },
  },
  { _id: false }
);

const projectReviewSchema = new Schema(
  {
    reviewId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    projectId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },

    submissionType: {
      type: String,
      enum: ["github", "zip"],
      required: true,
    },
    githubUrl: { type: String, default: "" },
    zipR2Key: { type: String, default: "" },
    originalFilename: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    jobId: { type: String, default: "", index: true },

    overallScore: { type: Number, default: 0 },
    scores: { type: scoresSchema, default: () => ({}) },
    summary: { type: String, default: "" },

    fileStats: { type: fileStatsSchema, default: () => ({}) },
    files: { type: [reviewedFileSchema], default: [] },
    issues: { type: [issueSchema], default: [] },

    error: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

projectReviewSchema.index({ projectId: 1, createdAt: -1 });
projectReviewSchema.index({ userId: 1, createdAt: -1 });

const ProjectReview = mongoose.model("ProjectReview", projectReviewSchema);
export default ProjectReview;
