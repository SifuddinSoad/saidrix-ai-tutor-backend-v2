// ===========================================
// Project-Maker Background Job Processor
// Mirrors processLectureJob in lecture.routes.js, but lives in the
// agent folder so BOTH the project route and the course-maker
// (auto-trigger after a course is created) can import it without an
// agent → route import cycle.
//
// Runs async — does not block the HTTP response. Domain failures are
// recorded on the Job doc (status "failed" + error), NOT thrown.
// ===========================================

import Course from "../../db/models/Course.js";
import Job from "../../db/models/Job.js";
import { invokeProjectMaker } from "./graph.js";
import logger from "../../utils/logger.js";

// params: { courseId, userId, sessionId, userContext?, source? }
export async function processProjectJob(jobId, params) {
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

    const {
      courseId,
      userId = "default",
      sessionId = null,
      userContext = "",
      source = "auto",
      // Auto-after-course path runs light (no research loop) to avoid
      // OpenRouter contention; user-initiated paths default to research.
      research = source !== "auto",
    } = params;

    const course = await Course.findOne({ courseId }).lean();
    if (!course) {
      throw new Error(`Course ${courseId} not found`);
    }

    await Job.findOneAndUpdate(
      { jobId },
      { "progress.percent": 20, "progress.message": "Designing projects..." }
    );

    const result = await invokeProjectMaker({
      courseId,
      course,
      sessionId,
      userId,
      userContext,
      source,
      research,
    });

    await Job.findOneAndUpdate(
      { jobId },
      {
        status: "completed",
        completedAt: new Date(),
        "progress.percent": 100,
        "progress.message": "Projects ready",
        relatedIds: { projectIds: result.projectIds, courseId },
      }
    );

    logger.info(
      `[Job ${jobId}] Project generation completed (${result.projectIds.length} projects)`
    );
    return result;
  } catch (err) {
    logger.error(`[Job ${jobId}] Project generation failed:`, err.message);
    await Job.findOneAndUpdate(
      { jobId },
      { status: "failed", completedAt: new Date(), error: err.message }
    ).catch((e) =>
      logger.error(`[Job ${jobId}] Could not record failure:`, e.message)
    );
    throw err;
  }
}

export default { processProjectJob };
