// ===========================================
// Chat REST API Routes
// Endpoints for session and message management
// ===========================================

import express, { Router } from "express";
import { randomUUID } from "crypto";
import Session from "../db/models/Session.js";
import Message from "../db/models/Message.js";
import ToolCallLog from "../db/models/ToolCallLog.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

const router = Router();

// --- helper: clamp pagination query ---
function paginate(query, defLimit = 20) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || defLimit, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
}

// ===========================================
// Session Endpoints
// ===========================================

// --- GET /sessions ---
router.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const { userId = "default" } = req.query;
    const { page, limit, skip } = paginate(req.query);

    const [sessions, total] = await Promise.all([
      Session.find({ userId })
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Session.countDocuments({ userId }),
    ]);

    res.json({
      sessions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// --- GET /sessions/:sessionId ---
router.get(
  "/sessions/:sessionId",
  asyncHandler(async (req, res) => {
    const session = await Session.findOne({
      sessionId: req.params.sessionId,
    }).lean();

    if (!session) {
      throw new NotFoundError("Session not found");
    }

    res.json({ session });
  })
);

// --- POST /sessions ---
router.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const {
      userId = "default",
      title = "New Chat",
      metadata = {},
    } = req.body || {};

    const sessionId = randomUUID();

    const session = await Session.create({
      sessionId,
      userId,
      title,
      metadata,
    });

    logger.info(`[Routes] Created session: ${sessionId}`);
    res.status(201).json({ session });
  })
);

// --- PATCH /sessions/:sessionId ---
router.patch(
  "/sessions/:sessionId",
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { title, metadata } = req.body || {};

    if (title === undefined && metadata === undefined) {
      throw new BadRequestError(
        "Request body must include at least one of: title, metadata"
      );
    }

    const existing = await Session.findOne({ sessionId });
    if (!existing) {
      throw new NotFoundError("Session not found");
    }

    if (typeof title === "string") {
      const trimmed = title.trim();
      if (trimmed.length > 0) existing.title = trimmed;
    }
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      existing.metadata = { ...(existing.metadata || {}), ...metadata };
      existing.markModified("metadata");
    }

    await existing.save();
    res.json({ session: existing.toObject() });
  })
);

// --- DELETE /sessions/:sessionId ---
router.delete(
  "/sessions/:sessionId",
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    await Promise.all([
      Session.deleteOne({ sessionId }),
      Message.deleteMany({ sessionId }),
      ToolCallLog.deleteMany({ sessionId }),
    ]);

    logger.info(`[Routes] Deleted session: ${sessionId}`);
    res.json({ message: "Session deleted", sessionId });
  })
);

// ===========================================
// Message Endpoints
// ===========================================

// --- GET /sessions/:sessionId/messages ---
router.get(
  "/sessions/:sessionId/messages",
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { page, limit, skip } = paginate(req.query, 50);

    const [messages, total] = await Promise.all([
      Message.find({ sessionId })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Message.countDocuments({ sessionId }),
    ]);

    res.json({
      messages,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// --- PATCH /sessions/:sessionId/messages/:messageId/answer-prompt ---
router.patch(
  "/sessions/:sessionId/messages/:messageId/answer-prompt",
  asyncHandler(async (req, res) => {
    const { sessionId, messageId } = req.params;
    const { promptId, selectedAnswers } = req.body || {};

    if (
      !promptId ||
      !Array.isArray(selectedAnswers) ||
      selectedAnswers.length === 0
    ) {
      throw new BadRequestError(
        "Body must include { promptId, selectedAnswers: string[] }"
      );
    }

    const msg = await Message.findOne({ sessionId, messageId });
    if (!msg) throw new NotFoundError("Message not found");

    const prompts = msg.prompts || [];
    const idx = prompts.findIndex((p) => p.id === promptId);
    if (idx === -1) throw new NotFoundError("Prompt not found on message");

    prompts[idx].answered = true;
    prompts[idx].selectedAnswers = selectedAnswers;
    prompts[idx].answeredAt = new Date();
    msg.prompts = prompts;
    msg.markModified("prompts");
    await msg.save();

    res.json({ message: msg.toObject() });
  })
);

// --- PATCH /sessions/:sessionId/messages/:messageId/proposal-created ---
// Marks one course in a proposal block as created so the "Created ✓"
// state survives a reload. Mirrors the answer-prompt endpoint.
router.patch(
  "/sessions/:sessionId/messages/:messageId/proposal-created",
  asyncHandler(async (req, res) => {
    const { sessionId, messageId } = req.params;
    const { courseId } = req.body || {};

    if (!courseId) {
      throw new BadRequestError("Body must include { courseId }");
    }

    const msg = await Message.findOne({ sessionId, messageId });
    if (!msg) throw new NotFoundError("Message not found");

    const proposal = msg.proposal;
    const courses = proposal?.courses || [];
    const idx = courses.findIndex((c) => c.id === courseId);
    if (idx === -1) throw new NotFoundError("Course not found on proposal");

    courses[idx].created = true;
    courses[idx].createdAt = new Date();
    msg.proposal = { ...proposal, courses };
    msg.markModified("proposal");
    await msg.save();

    res.json({ message: msg.toObject() });
  })
);

// ===========================================
// Tool-Call Log Endpoints
// ===========================================

// --- GET /sessions/:sessionId/tool-calls ---
router.get(
  "/sessions/:sessionId/tool-calls",
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { page, limit, skip } = paginate(req.query, 100);

    const [toolCalls, total] = await Promise.all([
      ToolCallLog.find({ sessionId })
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ToolCallLog.countDocuments({ sessionId }),
    ]);

    res.json({
      toolCalls,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// ===========================================
// Speech-to-text (chat voice input)
// ===========================================

// --- POST /transcribe ---
// Body: raw audio bytes (e.g. audio/webm). Forwards to Deepgram's
// prerecorded REST API and returns { transcript }.
router.post(
  "/transcribe",
  express.raw({ type: () => true, limit: "25mb" }),
  asyncHandler(async (req, res) => {
    const audio = req.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      throw new BadRequestError("No audio data received");
    }
    if (!process.env.DEEPGRAM_API_KEY) {
      throw new BadRequestError("Speech-to-text is not configured (DEEPGRAM_API_KEY missing)");
    }

    const params = new URLSearchParams({
      model: process.env.DEEPGRAM_MODEL || "nova-3",
      language: process.env.DEEPGRAM_LANGUAGE || "multi",
      smart_format: "true",
      punctuate: "true",
    });

    let dgRes;
    try {
      dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": req.headers["content-type"] || "audio/webm",
        },
        body: audio,
      });
    } catch (err) {
      logger.error(`[transcribe] Deepgram request failed: ${err.message}`);
      throw new BadRequestError("Transcription service unreachable");
    }

    if (!dgRes.ok) {
      const detail = await dgRes.text().catch(() => "");
      logger.error(`[transcribe] Deepgram ${dgRes.status}: ${detail.slice(0, 300)}`);
      throw new BadRequestError("Transcription failed");
    }

    const data = await dgRes.json();
    const transcript =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";

    res.json({ transcript });
  })
);

export default router;
