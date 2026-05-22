// ===========================================
// Course & Knowledge Base REST API Routes
// Endpoints for managing courses and RAG docs
// ===========================================

import { Router } from "express";
import { randomUUID } from "crypto";
import Course from "../db/models/Course.js";
import KnowledgeDoc from "../db/models/KnowledgeDoc.js";
import LectureCompletion from "../db/models/LectureCompletion.js";
import Lecture from "../db/models/Lecture.js";
import LectureProgress from "../db/models/LectureProgress.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import {
  countTopics,
  progressPercent,
  courseTag,
} from "../utils/courseProgress.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireActive } from "../middleware/requirePlan.js";
import { requireRole } from "../middleware/requireRole.js";
import logger from "../utils/logger.js";

const router = Router();

// Courses + knowledge are per-user; identity comes from the access token.
// IMPORTANT: scope to this router's OWN paths. The router is mounted at
// "/api" (root), so a path-less `router.use(authenticate)` would fire
// the auth check for every /api/* request — including /api/voice/*,
// /api/lectures/*, /api/enrichment/* — and 401 them all.
router.use(["/courses", "/knowledge"], authenticate, requireActive);

// --- helper: clamp pagination query ---
function paginate(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

// ===========================================
// Course Endpoints
// ===========================================

// --- GET /courses ---
router.get(
  "/courses",
  asyncHandler(async (req, res) => {
    const { subject } = req.query;
    const { page, limit, skip } = paginate(req.query);

    const filter = { userId: req.user.userId };
    if (subject) filter.subject = subject;

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Course.countDocuments(filter),
    ]);

    // Enrich each course with completion progress for list/cards.
    const enriched = await Promise.all(
      courses.map(async (c) => {
        const totalTopics = countTopics(c);
        const completed = await LectureCompletion.countDocuments({
          userId: req.user.userId,
          courseId: c.courseId,
        });
        return {
          ...c,
          tag: courseTag(c.course_title),
          lessons: totalTopics,
          progress: progressPercent(completed, totalTopics),
          locked: false,
        };
      })
    );

    res.json({
      courses: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// --- GET /courses/:courseId ---
router.get(
  "/courses/:courseId",
  asyncHandler(async (req, res) => {
    const course = await Course.findOne({
      courseId: req.params.courseId,
    }).lean();

    if (!course || course.userId !== req.user.userId) {
      throw new NotFoundError("Course not found");
    }

    const completions = await LectureCompletion.find({
      userId: req.user.userId,
      courseId: course.courseId,
    })
      .select("location -_id")
      .lean();

    const totalTopics = countTopics(course);
    const completedLocations = completions.map((c) => c.location);

    // Per-topic progress %. Pull all lectures for the course + their
    // LectureProgress docs for this user in two round-trips, then
    // join in memory.
    const lectures = await Lecture.find({ courseId: course.courseId })
      .select("lectureId location blocks")
      .lean();
    const progressDocs = lectures.length
      ? await LectureProgress.find({
          userId: req.user.userId,
          lectureId: { $in: lectures.map((l) => l.lectureId) },
        }).lean()
      : [];
    const progressByLectureId = new Map(
      progressDocs.map((p) => [p.lectureId, p])
    );
    const topicProgress = lectures.map((lec) => {
      const p = progressByLectureId.get(lec.lectureId);
      const total = lec.blocks?.length || 0;
      const done = p?.completed
        ? total
        : Math.max(0, (p?.lastBlockIndex ?? -1) + 1);
      return {
        location: lec.location,
        lectureId: lec.lectureId,
        totalBlocks: total,
        lastBlockIndex: p?.lastBlockIndex ?? -1,
        percent: total ? Math.round((done / total) * 100) : 0,
        completed: !!p?.completed,
      };
    });

    res.json({
      course: {
        ...course,
        tag: courseTag(course.course_title),
        lessons: totalTopics,
        progress: progressPercent(completedLocations.length, totalTopics),
        completedLocations,
        topicProgress,
      },
    });
  })
);

// --- DELETE /courses/:courseId ---
router.delete(
  "/courses/:courseId",
  asyncHandler(async (req, res) => {
    const result = await Course.deleteOne({
      courseId: req.params.courseId,
      userId: req.user.userId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundError("Course not found");
    }

    res.json({ message: "Course deleted", courseId: req.params.courseId });
  })
);

// ===========================================
// Knowledge Base Endpoints (RAG)
// ===========================================

// --- POST /knowledge ---
// KnowledgeDoc is global, shared RAG content with no per-user owner, so
// mutations are restricted to admins. Reads stay open to any active user.
router.post(
  "/knowledge",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const {
      subject,
      title,
      content,
      source = "",
      tags = [],
      metadata = {},
    } = req.body || {};

    if (!subject || !title || !content) {
      throw new BadRequestError(
        "Missing required fields: subject, title, content"
      );
    }

    const docId = randomUUID();
    const doc = await KnowledgeDoc.create({
      docId,
      subject,
      title,
      content,
      source,
      tags,
      metadata,
    });

    logger.info(`[Knowledge] Added doc: ${docId} (subject: ${subject})`);
    res.status(201).json({ doc });
  })
);

// --- POST /knowledge/bulk ---
router.post(
  "/knowledge/bulk",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const { docs } = req.body || {};

    if (!Array.isArray(docs) || docs.length === 0) {
      throw new BadRequestError("Body must contain a non-empty 'docs' array");
    }

    const invalid = docs.findIndex(
      (d) => !d || !d.subject || !d.title || !d.content
    );
    if (invalid !== -1) {
      throw new BadRequestError(
        `docs[${invalid}] is missing required fields: subject, title, content`
      );
    }

    const prepared = docs.map((d) => ({
      docId: randomUUID(),
      subject: d.subject,
      title: d.title,
      content: d.content,
      source: d.source || "",
      tags: d.tags || [],
      metadata: d.metadata || {},
    }));

    const inserted = await KnowledgeDoc.insertMany(prepared);

    logger.info(`[Knowledge] Bulk added: ${inserted.length} docs`);
    res.status(201).json({ inserted: inserted.length, docs: inserted });
  })
);

// --- GET /knowledge ---
router.get(
  "/knowledge",
  asyncHandler(async (req, res) => {
    const { subject } = req.query;
    const { page, limit, skip } = paginate(req.query);

    const filter = subject ? { subject } : {};

    const [docs, total] = await Promise.all([
      KnowledgeDoc.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      KnowledgeDoc.countDocuments(filter),
    ]);

    res.json({
      docs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// --- DELETE /knowledge/:docId ---
router.delete(
  "/knowledge/:docId",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const result = await KnowledgeDoc.deleteOne({
      docId: req.params.docId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundError("Knowledge doc not found");
    }

    res.json({ message: "Knowledge doc deleted", docId: req.params.docId });
  })
);

export default router;
