// ===========================================
// Progress REST API
// Records lecture/topic completions and awards XP + streak.
//   POST /api/progress/lecture-complete
// ===========================================

import { Router } from "express";
import Course from "../db/models/Course.js";
import LectureCompletion from "../db/models/LectureCompletion.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireActive } from "../middleware/requirePlan.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import { completeLecture } from "../services/progress.service.js";
import { countTopics, progressPercent } from "../utils/courseProgress.js";

const router = Router();
router.use(authenticate, requireActive);

function isInt(n) {
  return Number.isInteger(n) && n >= 0;
}

// --- POST /api/progress/lecture-complete ---
router.post(
  "/lecture-complete",
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { courseId, location } = req.body || {};

    if (!courseId || !location || typeof location !== "object") {
      throw new BadRequestError(
        "Body must include { courseId, location: { chapter, module, sub_module, topic } }"
      );
    }
    const { chapter, module, sub_module, topic } = location;
    if (![chapter, module, sub_module, topic].every(isInt)) {
      throw new BadRequestError(
        "location.{chapter,module,sub_module,topic} must be non-negative integers"
      );
    }

    const course = await Course.findOne({ courseId }).lean();
    if (!course || course.userId !== userId) {
      throw new NotFoundError("Course not found");
    }

    // Bounds-check the location against the course hierarchy.
    const t =
      course.chapters?.[chapter]?.modules?.[module]?.sub_modules?.[sub_module]
        ?.topics?.[topic];
    if (!t) {
      throw new BadRequestError("location does not point to a topic in this course");
    }

    const loc = { chapter, module, sub_module, topic };
    const { newlyCompleted, stats } = await completeLecture(
      userId,
      courseId,
      loc
    );

    const totalTopics = countTopics(course);
    const completed = await LectureCompletion.countDocuments({
      userId,
      courseId,
    });

    res.json({
      newlyCompleted,
      stats,
      course: {
        courseId,
        progress: progressPercent(completed, totalTopics),
        completedTopics: completed,
        totalTopics,
      },
    });
  })
);

export default router;
