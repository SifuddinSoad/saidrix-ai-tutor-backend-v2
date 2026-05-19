// ===========================================
// Course & Knowledge Base REST API Routes
// Endpoints for managing courses and RAG docs
// ===========================================

import { Router } from "express";
import { randomUUID } from "crypto";
import Course from "../db/models/Course.js";
import KnowledgeDoc from "../db/models/KnowledgeDoc.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

const router = Router();

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
    const { userId, subject } = req.query;
    const { page, limit, skip } = paginate(req.query);

    const filter = {};
    if (userId) filter.userId = userId;
    if (subject) filter.subject = subject;

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Course.countDocuments(filter),
    ]);

    res.json({
      courses,
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

    if (!course) {
      throw new NotFoundError("Course not found");
    }

    res.json({ course });
  })
);

// --- DELETE /courses/:courseId ---
router.delete(
  "/courses/:courseId",
  asyncHandler(async (req, res) => {
    const result = await Course.deleteOne({
      courseId: req.params.courseId,
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
router.post(
  "/knowledge",
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
