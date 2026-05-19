// ===========================================
// Voice REST API Routes
// Endpoints:
//   POST   /voice/sessions        - Create LiveKit room + token
//   GET    /voice/sessions/:id    - Get session state
//   GET    /voice/sessions        - List sessions
//   POST   /voice/sessions/:id/end - Mark session ended
//   DELETE /voice/sessions/:id    - Delete session
// ===========================================

import { Router } from "express";
import { randomUUID } from "crypto";
import Lecture from "../db/models/Lecture.js";
import VoiceSession from "../db/models/VoiceSession.js";
import { generateAccessToken } from "../utils/livekit.js";
import { explainLectureToDB } from "../agents/lecture-explainer/orchestrator.js";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
  UpstreamError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

const router = Router();

// ===========================================
// POST /voice/sessions
// Body: { lectureId, userId?, voiceId? }
// Returns: { sessionId, token, roomName, wsUrl }
// ===========================================

router.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const {
      lectureId,
      userId = "default",
      voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID || "",
      voiceInterrupts = true, // Phase 2: allow mic by default
    } = req.body || {};

    if (!lectureId) {
      throw new BadRequestError("Missing required field: lectureId");
    }

    const lecture = await Lecture.findOne({ lectureId }).lean();
    if (!lecture) {
      throw new NotFoundError("Lecture not found");
    }

    const sessionId = randomUUID();
    const roomName = `lecture-${sessionId}`;

    await VoiceSession.create({
      sessionId,
      lectureId,
      roomName,
      voiceId,
      model: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      userId,
      state: "pending",
    });

    // LiveKit token generation talks to an external dependency — surface
    // its failure as a 502 rather than a generic 500.
    let token;
    try {
      token = await generateAccessToken({
        roomName,
        identity: `student-${userId}-${sessionId.slice(0, 8)}`,
        name: userId,
        metadata: { sessionId, lectureId, role: "student" },
        canPublish: !!voiceInterrupts,
        canSubscribe: true,
      });
    } catch (err) {
      throw new UpstreamError("Failed to generate LiveKit access token", {
        cause: err,
      });
    }

    logger.info(`[Voice] Session created: ${sessionId} (lecture: ${lectureId})`);

    // Self-heal stale enrichment: version-aware cache means this is a
    // no-op (instant cache hit) when segments are already current, and
    // only rebuilds when they're stale/old-version (e.g. headings were
    // enriched by an older pipeline). Fire-and-forget — the worker polls
    // EnrichedSegment and falls back to raw text until fresh ones land.
    explainLectureToDB(lecture, {}).catch((err) =>
      logger.error(
        `[Voice] Background re-enrich failed for ${lectureId}: ${err.message}`
      )
    );

    res.status(201).json({
      sessionId,
      token,
      roomName,
      wsUrl: process.env.LIVEKIT_URL || "ws://localhost:7880",
      lectureId,
    });
  })
);

// ===========================================
// GET /voice/sessions/:sessionId
// ===========================================

router.get(
  "/sessions/:sessionId",
  asyncHandler(async (req, res) => {
    const session = await VoiceSession.findOne({
      sessionId: req.params.sessionId,
    }).lean();

    if (!session) {
      throw new NotFoundError("Voice session not found");
    }

    res.json({ session });
  })
);

// ===========================================
// GET /voice/sessions
// Query: userId, lectureId, state
// ===========================================

router.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const { userId, lectureId, state } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    const filter = {};
    if (userId) filter.userId = userId;
    if (lectureId) filter.lectureId = lectureId;
    if (state) filter.state = state;

    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      VoiceSession.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      VoiceSession.countDocuments(filter),
    ]);

    res.json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

// ===========================================
// POST /voice/sessions/:sessionId/end
// Mark session ended (frontend signals user closed the player)
// ===========================================

router.post(
  "/sessions/:sessionId/end",
  asyncHandler(async (req, res) => {
    const result = await VoiceSession.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      { state: "ended", endedAt: new Date() },
      { new: true }
    );

    if (!result) {
      throw new NotFoundError("Voice session not found");
    }

    res.json({ session: result });
  })
);

// ===========================================
// DELETE /voice/sessions/:sessionId
// ===========================================

router.delete(
  "/sessions/:sessionId",
  asyncHandler(async (req, res) => {
    const result = await VoiceSession.deleteOne({
      sessionId: req.params.sessionId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundError("Voice session not found");
    }

    res.json({
      message: "Voice session deleted",
      sessionId: req.params.sessionId,
    });
  })
);

export default router;
