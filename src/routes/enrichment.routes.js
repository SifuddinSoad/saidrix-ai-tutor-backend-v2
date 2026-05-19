// ===========================================
// Enrichment REST API Routes
// Trigger speech enrichment for a lecture independently
// from voice playback. Voice worker just reads the
// EnrichedSegment collection — no enrichment logic in
// the voice path.
//
// Endpoints:
//   POST   /enrichment/lectures/:lectureId          - Start enrichment (async, returns jobId)
//   POST   /enrichment/lectures/:lectureId/sync     - Synchronous enrichment (blocks)
//   POST   /enrichment/lectures/:lectureId/regenerate - Force re-enrichment
//   GET    /enrichment/job/:jobId                   - Poll enrichment job status
//   GET    /enrichment/lectures/:lectureId/segments - List enriched segments
//   GET    /enrichment/lectures/:lectureId/status   - Quick readiness check
//   DELETE /enrichment/lectures/:lectureId          - Clear enriched data
// ===========================================

import { Router } from "express";
import { randomUUID } from "crypto";
import Lecture from "../db/models/Lecture.js";
import EnrichedSegment from "../db/models/EnrichedSegment.js";
import Job from "../db/models/Job.js";
import {
  explainLectureToDB,
  PIPELINE_VERSION,
} from "../agents/lecture-explainer/orchestrator.js";
import {
  asyncHandler,
  NotFoundError,
  UpstreamError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

const router = Router();

// ===========================================
// Background Processor
// Domain failures recorded on the Job doc, not thrown.
// ===========================================

async function processEnrichmentJob(jobId, { lectureId, force }) {
  try {
    await Job.findOneAndUpdate(
      { jobId },
      {
        status: "running",
        startedAt: new Date(),
        "progress.percent": 5,
        "progress.message": "Loading lecture...",
      }
    );

    const lecture = await Lecture.findOne({ lectureId }).lean();
    if (!lecture) {
      throw new Error(`Lecture ${lectureId} not found`);
    }

    await Job.findOneAndUpdate(
      { jobId },
      { "progress.percent": 30, "progress.message": "Enriching segments..." }
    );

    const segments = await explainLectureToDB(lecture, { force });

    await Job.findOneAndUpdate(
      { jobId },
      {
        status: "completed",
        completedAt: new Date(),
        "progress.percent": 100,
        "progress.message": `Enriched ${segments.length} segments`,
        relatedIds: { lectureId, segmentCount: segments.length },
      }
    );

    logger.info(
      `[Enrichment Job ${jobId}] Completed (${segments.length} segments)`
    );
  } catch (err) {
    logger.error(`[Enrichment Job ${jobId}] Failed:`, err.message);
    await Job.findOneAndUpdate(
      { jobId },
      { status: "failed", completedAt: new Date(), error: err.message }
    ).catch((e) =>
      logger.error(
        `[Enrichment Job ${jobId}] Could not record failure:`,
        e.message
      )
    );
  }
}

// ===========================================
// Endpoints
// ===========================================

// --- POST /enrichment/lectures/:lectureId --- (async)
router.post(
  "/lectures/:lectureId",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const { force = false, userId = "default" } = req.body || {};

    const lecture = await Lecture.findOne({ lectureId }).lean();
    if (!lecture) {
      throw new NotFoundError("Lecture not found");
    }

    if (!force) {
      // Only count segments from the CURRENT pipeline version — stale
      // ones must NOT block re-enrichment (they auto-invalidate).
      const existingCount = await EnrichedSegment.countDocuments({
        lectureId,
        status: "ready",
        "metadata.pipelineVersion": PIPELINE_VERSION,
      });
      if (existingCount > 0) {
        return res.json({
          status: "already_enriched",
          lectureId,
          segmentCount: existingCount,
          message:
            "Lecture is already enriched. Use ?force=true to re-enrich.",
        });
      }
    }

    const jobId = randomUUID();
    await Job.create({
      jobId,
      type: "enrichment",
      status: "pending",
      input: { lectureId, force },
      userId,
    });

    processEnrichmentJob(jobId, { lectureId, force }).catch((err) => {
      logger.error(`[Enrichment Job ${jobId}] Unhandled:`, err.message);
    });

    logger.info(`[Enrichment] Job started: ${jobId} (lecture: ${lectureId})`);

    res.status(202).json({
      jobId,
      status: "pending",
      lectureId,
      message:
        "Enrichment started. Poll GET /api/enrichment/job/:jobId for status.",
    });
  })
);

// --- POST /enrichment/lectures/:lectureId/sync --- (blocking)
router.post(
  "/lectures/:lectureId/sync",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const { force = false } = req.body || {};

    const lecture = await Lecture.findOne({ lectureId }).lean();
    if (!lecture) {
      throw new NotFoundError("Lecture not found");
    }

    let segments;
    try {
      segments = await explainLectureToDB(lecture, { force });
    } catch (err) {
      throw new UpstreamError("Enrichment failed", { cause: err });
    }

    res.json({
      lectureId,
      segmentCount: segments.length,
      message: "Enrichment complete",
    });
  })
);

// --- POST /enrichment/lectures/:lectureId/regenerate --- (async, force)
router.post(
  "/lectures/:lectureId/regenerate",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const { userId = "default" } = req.body || {};

    const lecture = await Lecture.findOne({ lectureId }).lean();
    if (!lecture) {
      throw new NotFoundError("Lecture not found");
    }

    const jobId = randomUUID();
    await Job.create({
      jobId,
      type: "enrichment",
      status: "pending",
      input: { lectureId, force: true },
      userId,
    });

    processEnrichmentJob(jobId, { lectureId, force: true }).catch((err) => {
      logger.error(`[Enrichment Job ${jobId}] Unhandled:`, err.message);
    });

    res.status(202).json({
      jobId,
      status: "pending",
      lectureId,
      message: "Re-enrichment started",
    });
  })
);

// --- GET /enrichment/job/:jobId ---
router.get(
  "/job/:jobId",
  asyncHandler(async (req, res) => {
    const job = await Job.findOne({ jobId: req.params.jobId }).lean();
    if (!job) throw new NotFoundError("Job not found");

    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      relatedIds: job.relatedIds,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  })
);

// --- GET /enrichment/lectures/:lectureId/segments ---
router.get(
  "/lectures/:lectureId/segments",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const segments = await EnrichedSegment.find({ lectureId })
      .sort({ order: 1 })
      .lean();

    res.json({ lectureId, count: segments.length, segments });
  })
);

// --- GET /enrichment/lectures/:lectureId/status ---
router.get(
  "/lectures/:lectureId/status",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const [total, ready, failed] = await Promise.all([
      EnrichedSegment.countDocuments({ lectureId }),
      EnrichedSegment.countDocuments({ lectureId, status: "ready" }),
      EnrichedSegment.countDocuments({ lectureId, status: "failed" }),
    ]);

    res.json({
      lectureId,
      isReady: total > 0 && ready === total,
      total,
      ready,
      failed,
    });
  })
);

// --- DELETE /enrichment/lectures/:lectureId ---
router.delete(
  "/lectures/:lectureId",
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const result = await EnrichedSegment.deleteMany({ lectureId });
    res.json({ lectureId, deletedCount: result.deletedCount });
  })
);

export default router;
