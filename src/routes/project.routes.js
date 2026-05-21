// ===========================================
// Project REST API Routes
// Async job-based project generation (mirrors lecture.routes.js).
// Endpoints:
//   POST   /projects             - Start generation, returns jobId
//   GET    /projects/job/:jobId  - Poll job status
//   GET    /projects             - List projects (filter by courseId/userId)
//   GET    /projects/:projectId  - Get one project
//   DELETE /projects/:projectId  - Delete a project
// ===========================================

import { Router } from "express";
import { randomUUID } from "crypto";
import Course from "../db/models/Course.js";
import Project from "../db/models/Project.js";
import Job from "../db/models/Job.js";
import { processProjectJob } from "../agents/project-maker/job.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import { completeProject } from "../services/progress.service.js";
import { authenticate } from "../middleware/authenticate.js";
import { checkUsageLimit } from "../middleware/checkUsageLimit.js";
import logger from "../utils/logger.js";

const router = Router();

// Projects are per-user; identity comes from the access token.
router.use(authenticate);

function paginate(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

// --- POST /projects ---
// Generate project(s) for an existing course (async job).
// Gated by plan: trial users allowed, paid users counted against
// TIER_LIMITS[plan].projectReviews per billing period.
router.post(
  "/",
  checkUsageLimit("projectReviews"),
  asyncHandler(async (req, res) => {
    const { courseId, sessionId = null, userContext = "" } = req.body || {};
    const userId = req.user.userId;

    if (!courseId) {
      throw new BadRequestError("Missing required field: courseId");
    }

    const course = await Course.findOne({ courseId }).lean();
    if (!course || course.userId !== userId) {
      throw new NotFoundError("Course not found");
    }

    const jobId = randomUUID();
    const params = { courseId, userId, sessionId, userContext, source: "chat" };

    await Job.create({
      jobId,
      type: "project",
      status: "pending",
      input: params,
      userId,
    });

    processProjectJob(jobId, params).catch((err) => {
      logger.error(`[Job ${jobId}] Unhandled processor error:`, err.message);
    });

    logger.info(`[Projects] Job created: ${jobId}`);

    res.status(202).json({
      jobId,
      status: "pending",
      message:
        "Project generation started. Poll GET /api/projects/job/:jobId for status.",
    });
  })
);

// --- GET /projects/job/:jobId ---
// (declared before "/:projectId" so it isn't shadowed)
router.get(
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
    };

    if (job.status === "completed" && job.relatedIds?.projectIds) {
      const projects = await Project.find({
        projectId: { $in: job.relatedIds.projectIds },
      }).lean();
      response.projects = projects;
      response.projectIds = job.relatedIds.projectIds;
    }

    res.json(response);
  })
);

// --- GET /projects ---
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { courseId } = req.query;
    const { page, limit, skip } = paginate(req.query);

    const filter = { userId: req.user.userId };
    if (courseId) filter.courseId = courseId;

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Project.countDocuments(filter),
    ]);

    res.json({
      projects,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// --- GET /projects/:projectId ---
router.get(
  "/:projectId",
  asyncHandler(async (req, res) => {
    const project = await Project.findOne({
      projectId: req.params.projectId,
    }).lean();

    if (!project || project.userId !== req.user.userId) {
      throw new NotFoundError("Project not found");
    }

    res.json({ project });
  })
);

// --- PATCH /projects/:projectId/complete ---
// Marks a project completed and awards XP once (idempotent: re-calling
// when already completed grants nothing).
router.patch(
  "/:projectId/complete",
  asyncHandler(async (req, res) => {
    const project = await Project.findOne({
      projectId: req.params.projectId,
    });

    if (!project || project.userId !== req.user.userId) {
      throw new NotFoundError("Project not found");
    }

    const wasAlreadyCompleted = project.status === "completed";
    if (!wasAlreadyCompleted) {
      project.status = "completed";
      await project.save();
    }

    const { newlyCompleted, stats } = await completeProject(
      req.user.userId,
      wasAlreadyCompleted
    );

    res.json({ project: project.toObject(), newlyCompleted, stats });
  })
);

// --- DELETE /projects/:projectId ---
router.delete(
  "/:projectId",
  asyncHandler(async (req, res) => {
    const result = await Project.deleteOne({
      projectId: req.params.projectId,
      userId: req.user.userId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundError("Project not found");
    }

    res.json({ message: "Project deleted", projectId: req.params.projectId });
  })
);

export default router;
