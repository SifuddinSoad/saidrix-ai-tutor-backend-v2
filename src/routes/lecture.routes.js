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
import { ensureLectureImages } from "../agents/lecture-explainer/imageEnricher.js";
import LectureProgress from "../db/models/LectureProgress.js";
import LectureCompletion from "../db/models/LectureCompletion.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireActive } from "../middleware/requirePlan.js";
import {
  asyncHandler,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../errors/index.js";
import { isLocationUnlocked } from "../utils/courseProgress.js";
import logger from "../utils/logger.js";

const router = Router();

// Lectures + jobs are per-user; identity comes from the access token.
// Every endpoint below requires an active session and is scoped to the
// caller (ownership is enforced via the parent course / job.userId).
router.use(authenticate, requireActive);

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

    // --- Reuse existing lecture if one already exists for this topic ---
    // Avoids paying LLM cost + 30-60s wait on every entry. Enrichment
    // chain is still kicked off below; it's idempotent (version-aware
    // cache → no-op when segments are current).
    const existing = await Lecture.findOne({
      courseId,
      "location.chapter_index": location.chapter_index,
      "location.module_index": location.module_index,
      "location.sub_module_index": location.sub_module_index,
      "location.topic_index": location.topic_index,
    }).lean();

    if (existing) {
      await Job.findOneAndUpdate(
        { jobId },
        {
          status: "completed",
          completedAt: new Date(),
          "progress.percent": 100,
          "progress.message": "Reusing existing lecture",
          relatedIds: { lectureId: existing.lectureId },
        }
      );
      explainLectureToDB(existing, {}).catch((err) =>
        logger.error(
          `[Job ${jobId}] Background re-enrich failed for ${existing.lectureId}: ${err.message}`
        )
      );
      ensureLectureImages(existing.lectureId).catch((err) =>
        logger.error(
          `[Job ${jobId}] Image enrich failed for ${existing.lectureId}: ${err.message}`
        )
      );
      logger.info(
        `[Job ${jobId}] Reused existing lecture ${existing.lectureId} (skipped generation)`
      );
      return;
    }

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
      ensureLectureImages(result.lectureId).catch((err) =>
        logger.error(
          `[Job ${jobId}] Image enrich failed for ${result.lectureId}: ${err.message}`
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
    } = req.body || {};
    const userId = req.user.userId;

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

    // Sequential unlock: block generating a lecture whose prior topics
    // aren't all completed yet (a user could otherwise bypass the locked
    // roadmap UI by hitting this endpoint directly).
    const completed = await LectureCompletion.find({ userId, courseId })
      .select("location -_id")
      .lean();
    const targetLoc = {
      chapter_index,
      module_index,
      sub_module_index,
      topic_index,
    };
    if (!isLocationUnlocked(course, completed.map((c) => c.location), targetLoc)) {
      throw new ForbiddenError("Complete the previous lecture first");
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
    const { courseId } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    // Always scope to the caller; never trust a client-supplied userId.
    const filter = { userId: req.user.userId };
    if (courseId) filter.courseId = courseId;

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
    const { status } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    // Always scope to the caller; never trust a client-supplied userId.
    const filter = { type: "lecture", userId: req.user.userId };
    if (status) filter.status = status;

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
        userId: req.user.userId,
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
    const result = await Job.deleteOne({
      jobId: req.params.jobId,
      userId: req.user.userId,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundError("Job not found");
    }
    res.json({ message: "Job deleted", jobId: req.params.jobId });
  })
);

// --- GET /lectures/:lectureId/progress ---
// Returns the current user's resume point for this lecture. Defaults
// to { lastBlockIndex: -1, completed: false } if no progress exists.
router.get(
  "/:lectureId/progress",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const userId = req.user.userId;
    const prog = await LectureProgress.findOne({ userId, lectureId }).lean();
    if (!prog) {
      return res.json({
        progress: {
          lectureId, userId,
          lastBlockIndex: -1, totalBlocks: 0,
          completed: false, completedAt: null,
        },
      });
    }
    res.json({ progress: prog });
  })
);

// --- POST /lectures/:lectureId/progress ---
// Manual checkpoint save. Body: { lastBlockIndex, totalBlocks?, completed? }.
// The voice worker already writes per-block — this is for the End Class
// button and other client-initiated saves.
router.post(
  "/:lectureId/progress",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const userId = req.user.userId;
    const { lastBlockIndex, totalBlocks, completed } = req.body || {};

    if (typeof lastBlockIndex !== "number") {
      throw new BadRequestError("lastBlockIndex (number) is required");
    }

    const update = { lastBlockIndex };
    if (typeof totalBlocks === "number") update.totalBlocks = totalBlocks;
    if (completed === true) {
      update.completed = true;
      update.completedAt = new Date();
    }

    const prog = await LectureProgress.findOneAndUpdate(
      { userId, lectureId },
      { $set: update, $setOnInsert: { userId, lectureId } },
      { new: true, upsert: true }
    ).lean();

    res.json({ progress: prog });
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

    // Authoritative ownership check: the lecture's parent course must
    // belong to the caller.
    const course = await Course.findOne({ courseId: lecture.courseId })
      .select("userId -_id")
      .lean();
    if (!course || course.userId !== req.user.userId) {
      throw new NotFoundError("Lecture not found");
    }

    res.json({ lecture });
  })
);

// --- DELETE /lectures/:lectureId ---
router.delete(
  "/:lectureId",
  asyncHandler(async (req, res) => {
    const lecture = await Lecture.findOne({
      lectureId: req.params.lectureId,
    })
      .select("courseId -_id")
      .lean();

    if (!lecture) {
      throw new NotFoundError("Lecture not found");
    }

    // Authoritative ownership check via the parent course.
    const course = await Course.findOne({ courseId: lecture.courseId })
      .select("userId -_id")
      .lean();
    if (!course || course.userId !== req.user.userId) {
      throw new NotFoundError("Lecture not found");
    }

    await Lecture.deleteOne({ lectureId: req.params.lectureId });

    res.json({ message: "Lecture deleted", lectureId: req.params.lectureId });
  })
);

export default router;
