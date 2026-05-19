// ===========================================
// Lecture REST API Routes
// Async job-based lecture generation
// Endpoints:
//   POST   /lectures/generate        - Start generation, returns jobId
//   GET    /lectures/job/:jobId      - Poll job status
//   GET    /lectures/:lectureId      - Get a completed lecture
//   GET    /lectures                  - List lectures (filter by courseId)
//   DELETE /lectures/:lectureId      - Delete a lecture
// ===========================================

import { Router } from "express";
import { randomUUID } from "crypto";
import Course from "../db/models/Course.js";
import Lecture from "../db/models/Lecture.js";
import Job from "../db/models/Job.js";
import { invokeLectureMaker } from "../agents/lecture-maker/graph.js";
import { explainLectureToDB } from "../agents/lecture-explainer/orchestrator.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

const router = Router();

// ===========================================
// Background Job Processor
// Runs async — does not block the HTTP response.
// Domain failures are recorded on the Job doc (status
// "failed" + error), NOT thrown to the HTTP layer.
// ===========================================

async function processLectureJob(jobId, params) {
  try {
    await Job.findOneAndUpdate(
      { jobId },
      {
        status: "running",
        startedAt: new Date(),
        "progress.percent": 5,
        "progress.message": "Loading course context...",
      }
    );

    const { courseId, location, userId } = params;

    const course = await Course.findOne({ courseId }).lean();
    if (!course) {
      throw new Error(`Course ${courseId} not found`);
    }

    const chapter = course.chapters?.[location.chapter_index];
    if (!chapter) throw new Error(`Chapter ${location.chapter_index} not found`);

    const module = chapter.modules?.[location.module_index];
    if (!module) throw new Error(`Module ${location.module_index} not found`);

    const subModule = module.sub_modules?.[location.sub_module_index];
    if (!subModule)
      throw new Error(`Sub-module ${location.sub_module_index} not found`);

    const topic = subModule.topics?.[location.topic_index];
    if (!topic) throw new Error(`Topic ${location.topic_index} not found`);

    const onProgress = async (percent, message) => {
      try {
        await Job.findOneAndUpdate(
          { jobId },
          { "progress.percent": percent, "progress.message": message }
        );
      } catch (err) {
        logger.warn(`[Job ${jobId}] Progress update failed:`, err.message);
      }
    };

    const result = await invokeLectureMaker({
      course,
      location,
      topic,
      userId,
      onProgress,
    });

    await Job.findOneAndUpdate(
      { jobId },
      {
        status: "completed",
        completedAt: new Date(),
        "progress.percent": 100,
        "progress.message": "Lecture ready",
        relatedIds: { lectureId: result.lectureId },
      }
    );

    logger.info(`[Job ${jobId}] Completed successfully`);

    // Auto-chain enrichment so voice-ready segments start populating
    // immediately (the voice/live path polls EnrichedSegment). Without
    // this the Live page would poll enrichment status forever — total
    // stays 0 because nothing ever enriches. Fire-and-forget: lecture
    // generation is already "completed"; enrichment fills in the voice.
    if (result?.lecture?.lectureId) {
      logger.info(
        `[Job ${jobId}] Lecture ready (${result.lectureId}) — starting enrichment`
      );
      explainLectureToDB(result.lecture, {})
        .then((segs) =>
          logger.info(
            `[Job ${jobId}] Enrichment finished for ${result.lectureId} (${segs.length} segments)`
          )
        )
        .catch((err) =>
          logger.error(
            `[Job ${jobId}] Enrichment failed for ${result.lectureId}: ${err.message}`
          )
        );
    } else {
      logger.warn(
        `[Job ${jobId}] No lecture object returned — skipping enrichment chain`
      );
    }
  } catch (err) {
    logger.error(`[Job ${jobId}] Failed:`, err.message);
    await Job.findOneAndUpdate(
      { jobId },
      { status: "failed", completedAt: new Date(), error: err.message }
    ).catch((e) =>
      logger.error(`[Job ${jobId}] Could not record failure:`, e.message)
    );
  }
}

// ===========================================
// Endpoints
// ===========================================

// --- POST /lectures/generate ---
router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const {
      courseId,
      chapter_index,
      module_index,
      sub_module_index,
      topic_index,
      userId = "default",
    } = req.body || {};

    if (
      !courseId ||
      chapter_index === undefined ||
      module_index === undefined ||
      sub_module_index === undefined ||
      topic_index === undefined
    ) {
      throw new BadRequestError(
        "Missing required fields: courseId, chapter_index, module_index, sub_module_index, topic_index"
      );
    }

    const course = await Course.findOne({ courseId }).lean();
    if (!course) {
      throw new NotFoundError("Course not found");
    }

    const jobId = randomUUID();
    const params = {
      courseId,
      location: {
        chapter_index,
        module_index,
        sub_module_index,
        topic_index,
      },
      userId,
    };

    await Job.create({
      jobId,
      type: "lecture",
      status: "pending",
      input: params,
      userId,
    });

    processLectureJob(jobId, params).catch((err) => {
      logger.error(`[Job ${jobId}] Unhandled processor error:`, err.message);
    });

    logger.info(`[Lectures] Job created: ${jobId}`);

    res.status(202).json({
      jobId,
      status: "pending",
      message:
        "Lecture generation started. Poll GET /api/lectures/job/:jobId for status.",
    });
  })
);

// --- GET /lectures/job/:jobId ---
router.get(
  "/job/:jobId",
  asyncHandler(async (req, res) => {
    const job = await Job.findOne({ jobId: req.params.jobId }).lean();

    if (!job) {
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

    if (job.status === "completed" && job.relatedIds?.lectureId) {
      const lecture = await Lecture.findOne({
        lectureId: job.relatedIds.lectureId,
      }).lean();
      response.lecture = lecture;
      response.lectureId = job.relatedIds.lectureId;
    }

    res.json(response);
  })
);

// --- GET /lectures ---
// (declared before "/:lectureId" so it isn't shadowed)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { courseId, userId } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const filter = {};
    if (courseId) filter.courseId = courseId;
    if (userId) filter.userId = userId;

    const skip = (page - 1) * limit;

    const [lectures, total] = await Promise.all([
      Lecture.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-blocks")
        .lean(),
      Lecture.countDocuments(filter),
    ]);

    res.json({
      lectures,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// ===========================================
// Job Management Endpoints
// (declared before "/:lectureId" to avoid route shadowing)
// ===========================================

// --- GET /lectures/jobs/list ---
router.get(
  "/jobs/list",
  asyncHandler(async (req, res) => {
    const { status, userId } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const filter = { type: "lecture" };
    if (status) filter.status = status;
    if (userId) filter.userId = userId;

    const jobs = await Job.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ jobs, count: jobs.length });
  })
);

// --- POST /lectures/jobs/cleanup ---
router.post(
  "/jobs/cleanup",
  asyncHandler(async (req, res) => {
    const maxAgeMinutes = Number(req.body?.maxAgeMinutes) || 15;
    if (maxAgeMinutes <= 0) {
      throw new BadRequestError("maxAgeMinutes must be a positive number");
    }
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    const result = await Job.updateMany(
      {
        type: "lecture",
        status: { $in: ["pending", "running"] },
        createdAt: { $lt: cutoff },
      },
      {
        status: "failed",
        completedAt: new Date(),
        error: `Marked as failed by cleanup (stuck > ${maxAgeMinutes} minutes)`,
      }
    );

    logger.info(
      `[Lectures] Cleanup: marked ${result.modifiedCount} stuck jobs as failed`
    );
    res.json({
      cleaned: result.modifiedCount,
      message: `Marked ${result.modifiedCount} stuck jobs as failed`,
    });
  })
);

// --- DELETE /lectures/jobs/:jobId ---
router.delete(
  "/jobs/:jobId",
  asyncHandler(async (req, res) => {
    const result = await Job.deleteOne({ jobId: req.params.jobId });
    if (result.deletedCount === 0) {
      throw new NotFoundError("Job not found");
    }
    res.json({ message: "Job deleted", jobId: req.params.jobId });
  })
);

// --- GET /lectures/:lectureId ---
router.get(
  "/:lectureId",
  asyncHandler(async (req, res) => {
    const lecture = await Lecture.findOne({
      lectureId: req.params.lectureId,
    }).lean();

    if (!lecture) {
      throw new NotFoundError("Lecture not found");
    }

    res.json({ lecture });
  })
);

// --- DELETE /lectures/:lectureId ---
router.delete(
  "/:lectureId",
  asyncHandler(async (req, res) => {
    const result = await Lecture.deleteOne({
      lectureId: req.params.lectureId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundError("Lecture not found");
    }

    res.json({ message: "Lecture deleted", lectureId: req.params.lectureId });
  })
);

export default router;
