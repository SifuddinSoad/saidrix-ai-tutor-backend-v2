// ===========================================
// Routine REST API Routes
// Generates and stores a day-by-day study plan. Routine generation
// is a single structured-output call (fast enough to run inline; if
// it grows, switch to the Job pattern like projects/lectures).
// Endpoints:
//   POST   /routines             - Generate + store a routine
//   GET    /routines             - List routines (filter by userId)
//   GET    /routines/:routineId  - Get one routine
//   DELETE /routines/:routineId  - Delete a routine
// ===========================================

import { Router } from "express";
import Course from "../db/models/Course.js";
import Routine from "../db/models/Routine.js";
import { invokeRoutineManager } from "../agents/routine-manager/graph.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

const router = Router();

function paginate(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

// --- POST /routines ---
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const {
      courseIds,
      dailyHours = 1,
      startDate,
      userId = "default",
      sessionId = null,
    } = req.body || {};

    const ids = Array.isArray(courseIds)
      ? courseIds
      : courseIds
        ? [courseIds]
        : [];

    if (ids.length === 0) {
      throw new BadRequestError(
        "Missing required field: courseIds (non-empty array)"
      );
    }
    if (!(Number(dailyHours) > 0)) {
      throw new BadRequestError("dailyHours must be a positive number");
    }

    const start = startDate ? new Date(startDate) : new Date();
    if (isNaN(start.getTime())) {
      throw new BadRequestError("Invalid startDate");
    }

    const found = await Course.countDocuments({ courseId: { $in: ids } });
    if (found === 0) {
      throw new NotFoundError("No matching courses found");
    }

    const result = await invokeRoutineManager({
      userId,
      courseIds: ids,
      dailyHours: Number(dailyHours),
      startDate: start,
      sessionId,
    });

    logger.info(`[Routines] Created: ${result.routineId}`);

    res.status(201).json({
      routineId: result.routineId,
      routine: result.routine,
      summary: result.summary,
    });
  })
);

// --- GET /routines ---
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { userId } = req.query;
    const { page, limit, skip } = paginate(req.query);

    const filter = {};
    if (userId) filter.userId = userId;

    const [routines, total] = await Promise.all([
      Routine.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Routine.countDocuments(filter),
    ]);

    res.json({
      routines,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// --- GET /routines/:routineId ---
router.get(
  "/:routineId",
  asyncHandler(async (req, res) => {
    const routine = await Routine.findOne({
      routineId: req.params.routineId,
    }).lean();

    if (!routine) {
      throw new NotFoundError("Routine not found");
    }

    res.json({ routine });
  })
);

// --- DELETE /routines/:routineId ---
router.delete(
  "/:routineId",
  asyncHandler(async (req, res) => {
    const result = await Routine.deleteOne({
      routineId: req.params.routineId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundError("Routine not found");
    }

    res.json({ message: "Routine deleted", routineId: req.params.routineId });
  })
);

export default router;
