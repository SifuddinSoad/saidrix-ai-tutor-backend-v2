// ===========================================
// Project Review REST API
// Endpoints (all auth-required):
//   POST   /api/projects/:projectId/reviews/submit-github
//   POST   /api/projects/:projectId/reviews/submit-zip   (multipart)
//   GET    /api/projects/:projectId/reviews              (history)
//   GET    /api/reviews/:reviewId
//   GET    /api/reviews/:reviewId/issues
//   GET    /api/reviews/job/:jobId
// ===========================================

import { Router } from "express";
import { randomUUID } from "crypto";
import Project from "../db/models/Project.js";
import ProjectReview from "../db/models/ProjectReview.js";
import Job from "../db/models/Job.js";
import AdmZip from "adm-zip";
import { uploadZip, uploadFolder } from "../middleware/upload.js";
import { uploadBuffer } from "../services/r2.client.js";
import { processProjectReviewJob } from "../agents/project-reviewer/job.js";
import { MAX_ZIP_BYTES } from "../config/review.config.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireActive } from "../middleware/requirePlan.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

// Two routers — one nested under /api/projects/:projectId/reviews,
// one flat under /api/reviews — wired separately in app.js.
export const nestedRouter = Router({ mergeParams: true });
export const flatRouter = Router();

nestedRouter.use(authenticate, requireActive);
flatRouter.use(authenticate, requireActive);

// Helper: assert the project exists and belongs to the caller.
async function loadOwnedProject(projectId, userId) {
  const project = await Project.findOne({ projectId }).lean();
  if (!project || project.userId !== userId) {
    throw new NotFoundError("Project not found");
  }
  return project;
}

function kickoffReviewJob(review) {
  processProjectReviewJob(review.jobId, review.reviewId).catch((err) =>
    logger.error(
      `[ProjectReviewer] Unhandled processor error for ${review.reviewId}: ${err.message}`
    )
  );
}

async function createJobAndReview({ project, userId, payload }) {
  const reviewId = randomUUID();
  const jobId = randomUUID();

  await Job.create({
    jobId,
    type: "projectReview",
    status: "pending",
    input: { reviewId, projectId: project.projectId, ...payload },
    userId,
  });

  const review = await ProjectReview.create({
    reviewId,
    projectId: project.projectId,
    userId,
    status: "pending",
    jobId,
    ...payload,
  });

  return review;
}

// ---------- POST submit-github ----------
nestedRouter.post(
  "/submit-github",
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const userId = req.user.userId;
    const { githubUrl } = req.body || {};

    if (!githubUrl || typeof githubUrl !== "string") {
      throw new BadRequestError("Missing githubUrl");
    }
    if (!/^https?:\/\/(www\.)?(github\.com|gitlab\.com|bitbucket\.org)\//i.test(githubUrl)) {
      throw new BadRequestError("Only GitHub/GitLab/Bitbucket URLs are supported");
    }

    const project = await loadOwnedProject(projectId, userId);

    const review = await createJobAndReview({
      project,
      userId,
      payload: { submissionType: "github", githubUrl: githubUrl.trim() },
    });

    kickoffReviewJob(review);

    res.status(202).json({
      reviewId: review.reviewId,
      jobId: review.jobId,
      status: "pending",
    });
  })
);

// ---------- POST submit-zip ----------
nestedRouter.post(
  "/submit-zip",
  (req, res, next) =>
    uploadZip(req, res, (err) => {
      if (err) return next(new BadRequestError(err.message));
      next();
    }),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const userId = req.user.userId;

    if (!req.file) throw new BadRequestError("No file uploaded (field name: 'file')");
    if (req.file.size > MAX_ZIP_BYTES) {
      throw new BadRequestError(`ZIP exceeds ${MAX_ZIP_BYTES} bytes`);
    }

    const project = await loadOwnedProject(projectId, userId);

    const key = `reviews/${userId}/${projectId}/${randomUUID()}.zip`;
    await uploadBuffer(key, req.file.buffer, "application/zip");

    const review = await createJobAndReview({
      project,
      userId,
      payload: {
        submissionType: "zip",
        zipR2Key: key,
        originalFilename: req.file.originalname,
      },
    });

    kickoffReviewJob(review);

    res.status(202).json({
      reviewId: review.reviewId,
      jobId: review.jobId,
      status: "pending",
    });
  })
);

// ---------- POST submit-folder (multi-file, webkitdirectory) ----------
nestedRouter.post(
  "/submit-folder",
  (req, res, next) =>
    uploadFolder(req, res, (err) => {
      if (err) return next(new BadRequestError(err.message));
      next();
    }),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const userId = req.user.userId;

    if (!req.files || req.files.length === 0) {
      throw new BadRequestError("No files uploaded (field name: 'files')");
    }

    // Client posts the relative paths as a JSON array, index-matched
    // with req.files. Falls back to originalname if not provided.
    let paths = [];
    try {
      paths = req.body.paths ? JSON.parse(req.body.paths) : [];
    } catch {
      throw new BadRequestError("Invalid paths field (must be JSON array)");
    }

    // Aggregate size sanity check.
    const totalBytes = req.files.reduce((n, f) => n + f.size, 0);
    if (totalBytes > MAX_ZIP_BYTES) {
      throw new BadRequestError(
        `Folder exceeds total size limit (${MAX_ZIP_BYTES} bytes)`
      );
    }

    const project = await loadOwnedProject(projectId, userId);

    // Build a zip in memory so the rest of the pipeline (R2 → job →
    // unzip → walk) stays identical to the legacy ZIP flow.
    const zip = new AdmZip();
    req.files.forEach((file, i) => {
      const rel = paths[i] || file.originalname || `file-${i}`;
      // Strip leading "./" and prevent absolute-path / parent-dir escapes.
      const safe = rel
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/^\/+/, "")
        .split("/")
        .filter((seg) => seg && seg !== "..")
        .join("/");
      if (safe) zip.addFile(safe, file.buffer);
    });
    const zipBuffer = zip.toBuffer();

    const folderName =
      paths[0]?.split("/")[0] ||
      req.files[0].originalname ||
      "project";

    const key = `reviews/${userId}/${projectId}/${randomUUID()}.zip`;
    await uploadBuffer(key, zipBuffer, "application/zip");

    const review = await createJobAndReview({
      project,
      userId,
      payload: {
        submissionType: "zip",
        zipR2Key: key,
        originalFilename: folderName,
      },
    });

    kickoffReviewJob(review);

    res.status(202).json({
      reviewId: review.reviewId,
      jobId: review.jobId,
      status: "pending",
    });
  })
);

// ---------- GET project review history ----------
nestedRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const userId = req.user.userId;
    await loadOwnedProject(projectId, userId);

    const reviews = await ProjectReview.find({ projectId, userId })
      .sort({ createdAt: -1 })
      .select(
        "reviewId status submissionType overallScore scores summary fileStats createdAt completedAt error"
      )
      .lean();

    res.json({ reviews });
  })
);

// ---------- GET full review ----------
flatRouter.get(
  "/:reviewId",
  asyncHandler(async (req, res) => {
    const review = await ProjectReview.findOne({
      reviewId: req.params.reviewId,
    }).lean();
    if (!review || review.userId !== req.user.userId) {
      throw new NotFoundError("Review not found");
    }
    res.json({ review });
  })
);

// ---------- GET issues only (with filters) ----------
flatRouter.get(
  "/:reviewId/issues",
  asyncHandler(async (req, res) => {
    const { file, severity, category } = req.query;
    const review = await ProjectReview.findOne({
      reviewId: req.params.reviewId,
    }).lean();
    if (!review || review.userId !== req.user.userId) {
      throw new NotFoundError("Review not found");
    }
    let issues = review.issues || [];
    if (file) issues = issues.filter((i) => i.filePath === file);
    if (severity) issues = issues.filter((i) => i.severity === severity);
    if (category) issues = issues.filter((i) => i.category === category);
    res.json({ issues, total: issues.length });
  })
);

// ---------- GET job status ----------
flatRouter.get(
  "/job/:jobId",
  asyncHandler(async (req, res) => {
    const job = await Job.findOne({ jobId: req.params.jobId }).lean();
    if (!job || job.userId !== req.user.userId) {
      throw new NotFoundError("Job not found");
    }
    const response = {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      reviewId: job.relatedIds?.reviewId || job.input?.reviewId || null,
    };
    res.json(response);
  })
);

export default { nestedRouter, flatRouter };
