// ===========================================
// Voice Tutor Worker (Phase 2)
// LiveKit agent entry point with:
//   - Lecture playback (Phase 1)
//   - Always-on Silero VAD + Deepgram STT
//   - In-lecture Q&A via OpenRouter LLM + ElevenLabs TTS
//   - Frontend data-channel control commands
//
// Run: npm run start:voice
// ===========================================

import "dotenv/config";
import { defineAgent, WorkerOptions, cli } from "@livekit/agents";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import { playLecture } from "./lecturePlayer.js";
import { PlayerControl, STATE } from "./playerControl.js";
import { setupControlHandler } from "./controlHandler.js";
import { loadVAD } from "./vad.js";
import { createSTT } from "./deepgramSTT.js";
import { AudioSubscriber } from "./audioSubscriber.js";
import { handleQuestion } from "./qa.js";
import {
  sendStateListening,
  sendStateReading,
  sendStatePaused,
  sendStateCompleted,
  sendBlockStart,
} from "./dataChannel.js";
import VoiceSession from "../../db/models/VoiceSession.js";
import Lecture from "../../db/models/Lecture.js";
import EnrichedSegment from "../../db/models/EnrichedSegment.js";
import logger from "../../utils/logger.js";

// ===========================================
// MongoDB connection (worker is a separate process)
// ===========================================

async function ensureDB() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/saidrix-ai-tutor";
  await mongoose.connect(uri);
  logger.info("[VoiceWorker] MongoDB connected");
}

// ===========================================
// Wait until a remote (student) participant is present, so reliable
// data events (state / block_start) are published while the browser
// is connected and listening — otherwise the lecture never reveals.
// Resolves on join, or after `timeoutMs` (then plays anyway so a
// no-show can't hang the worker). A short grace delay after join lets
// the participant's data subscription settle before the first event.
// ===========================================

function remoteCount(room) {
  const r = room?.remoteParticipants || room?.participants;
  return r?.size ?? r?.length ?? 0;
}

async function waitForStudent(room, timeoutMs = 20000) {
  if (remoteCount(room) > 0) {
    logger.info("[VoiceWorker] Student already present — starting playback");
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }

  logger.info("[VoiceWorker] Waiting for student to join before playback...");
  const evts = ["participantConnected", "participant_connected"];

  const joined = await new Promise((resolve) => {
    let settled = false;
    const onJoin = () => {
      if (!settled && remoteCount(room) > 0) finish(true);
    };
    const finish = (v) => {
      if (settled) return;
      settled = true;
      for (const e of evts) {
        try {
          room.off?.(e, onJoin) ?? room.removeListener?.(e, onJoin);
        } catch {
          /* noop */
        }
      }
      clearTimeout(timer);
      resolve(v);
    };
    for (const e of evts) {
      try {
        room.on(e, onJoin);
      } catch {
        /* noop */
      }
    }
    const timer = setTimeout(() => finish(false), timeoutMs);
    // Re-check in case the participant joined between the initial check
    // and listener attachment.
    if (remoteCount(room) > 0) finish(true);
  });

  if (joined) {
    logger.info(
      "[VoiceWorker] Student joined — settling data subscription before playback"
    );
    await new Promise((r) => setTimeout(r, 800));
    return true;
  }

  logger.warn(
    `[VoiceWorker] No student within ${timeoutMs}ms — starting playback anyway (early events may be missed)`
  );
  return false;
}

// ===========================================
// Agent Definition
// ===========================================

export default defineAgent({
  // --- Warm-up (loads VAD model once per process) ---
  prewarm: async (proc) => {
    try {
      await ensureDB();
      proc.userData = proc.userData || {};
      proc.userData.vad = await loadVAD();
    } catch (err) {
      logger.error("[VoiceWorker] Prewarm failed:", err.message);
    }
  },

  // --- Per-room dispatch ---
  entry: async (ctx) => {
    logger.info(`[VoiceWorker] Job received for room: ${ctx.room?.name}`);
    await ensureDB();

    // Auto-subscribe to audio tracks so remote participants' mic
    // streams flow to us. Without this the agent never receives
    // student audio and VAD/STT see nothing.
    try {
      // UNVERIFIED: AutoSubscribe import path; using string fallback.
      const agentsMod = await import("@livekit/agents");
      const AutoSubscribe = agentsMod.AutoSubscribe;
      await ctx.connect({
        autoSubscribe: AutoSubscribe?.AUDIO_ONLY ?? "audio_only",
      });
    } catch {
      await ctx.connect();
    }
    logger.info(`[VoiceWorker] Connected to room: ${ctx.room.name}`);

    // --- Room lifecycle diagnostics — find out WHY no audio events fire ---
    const events = [
      "participantConnected", "participant_connected",
      "participantDisconnected", "participant_disconnected",
      "trackPublished", "track_published",
      "trackSubscribed", "track_subscribed",
      "trackUnpublished", "track_unpublished",
      "disconnected",
    ];
    for (const evt of events) {
      try {
        ctx.room.on(evt, (...args) => {
          // Extract a readable summary
          const summary = args
            .map((a) => {
              if (!a) return "null";
              if (a.identity) return `participant=${a.identity}`;
              if (a.kind) return `track(kind=${a.kind}, sid=${a.sid || "?"})`;
              if (typeof a === "string") return a;
              return typeof a;
            })
            .join(" | ");
          logger.info(`[Room] ${evt}: ${summary}`);
        });
      } catch {}
    }

    // Log current room state right now (in case events already fired)
    try {
      const remotes = ctx.room.remoteParticipants || ctx.room.participants;
      const count = remotes?.size ?? remotes?.length ?? 0;
      logger.info(`[Room] Current remote participants: ${count}`);
      remotes?.forEach?.((p) => {
        const tracks = p.trackPublications || p.tracks || new Map();
        const trackCount = tracks?.size ?? 0;
        logger.info(`[Room]   → ${p.identity} (${trackCount} tracks)`);
        tracks?.forEach?.((pub) => {
          logger.info(`[Room]      track: kind=${pub.kind} subscribed=${!!pub.track}`);
        });
      });
    } catch (err) {
      logger.warn(`[Room] State snapshot failed: ${err.message}`);
    }

    // --- Extract sessionId from room metadata or name ---
    let sessionId = null;
    try {
      if (ctx.room.metadata) {
        const meta = JSON.parse(ctx.room.metadata);
        sessionId = meta.sessionId;
      }
    } catch {}
    if (!sessionId && ctx.room.name?.startsWith("lecture-")) {
      sessionId = ctx.room.name.replace("lecture-", "");
    }
    if (!sessionId) {
      logger.error("[VoiceWorker] No sessionId in room metadata/name");
      return;
    }

    // --- Set up PlayerControl + data-channel control commands ---
    const playerControl = new PlayerControl();
    const teardownControl = setupControlHandler(ctx.room, playerControl);

    // --- Catch-up re-emit on (re)join ---
    // LiveKit reliable data has NO backfill: a browser that connects (or
    // reconnects / StrictMode-remounts) after we already published
    // state/block_start will never have received them, so the lecture
    // display would stay frozen even though audio (a continuous track)
    // plays. On every participant join, re-send the current state + the
    // current block so the client immediately resyncs. Idempotent on the
    // frontend (revealed uses Math.max); cheap (2 small reliable packets).
    const reemitSync = async () => {
      try {
        if (playerControl.state === STATE.COMPLETED) {
          await sendStateCompleted(ctx.room);
        } else if (playerControl.state === STATE.PAUSED) {
          await sendStatePaused(
            ctx.room,
            playerControl.pauseReason || "user"
          );
        } else {
          await sendStateReading(ctx.room);
        }
        if (playerControl.currentBlockIndex != null) {
          await sendBlockStart(ctx.room, playerControl.currentBlockIndex);
        }
      } catch {
        /* never let a resync attempt break the worker */
      }
    };
    const onLateJoin = () => {
      // Small settle delay so the new participant's data path is ready.
      setTimeout(() => {
        reemitSync().catch(() => {});
      }, 800);
    };
    for (const e of ["participantConnected", "participant_connected"]) {
      try {
        ctx.room.on(e, onLateJoin);
      } catch {
        /* noop */
      }
    }

    // --- Load lecture (enrichment is OWNED by /api/enrichment endpoints) ---
    const session = await VoiceSession.findOne({ sessionId }).lean();
    const lecture = session
      ? await Lecture.findOne({ lectureId: session.lectureId }).lean()
      : null;

    // Check whether enriched segments exist. If not, log a warning —
    // voice player will fall back to plain (unenriched) speech plan.
    // The proper workflow is for the client to call
    //   POST /api/enrichment/lectures/:lectureId
    // BEFORE creating a voice session.
    if (lecture) {
      const enrichedCount = await EnrichedSegment.countDocuments({
        lectureId: lecture.lectureId,
        status: "ready",
      });
      if (enrichedCount === 0) {
        logger.warn(
          `[VoiceWorker] No enriched segments for lecture ${lecture.lectureId}. ` +
            `Trigger POST /api/enrichment/lectures/${lecture.lectureId} first. ` +
            `Falling back to plain (no-emotion) speech.`
        );
      } else {
        logger.info(
          `[VoiceWorker] Found ${enrichedCount} enriched segments — ready to play`
        );
      }
    }

    // --- Audio subscriber + Q&A pipeline (Phase 2) ---
    let audioSub = null;
    let publisherRef = null; // set after playLecture starts
    let qaActive = false;
    let teardownTextQ = null; // inbound typed-question listener teardown

    // Speech window tracking for resume-on-noise logic
    let speechStartTime = null;
    let resumeTimer = null;

    // Constants for speech filtering
    const MIN_SPEECH_DURATION_MS = 400;   // speech shorter than this is noise
    const TRANSCRIPT_GRACE_PERIOD_MS = 2500; // wait this long for STT after END

    try {
      const vad = ctx.proc?.userData?.vad || (await loadVAD());
      const stt = createSTT();

      const clearResumeTimer = () => {
        if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
      };

      const onSpeechStart = async () => {
        if (qaActive) return;
        speechStartTime = Date.now();
        clearResumeTimer();
        logger.info("[VoiceWorker] Pausing lecture — student speaking");
        playerControl.pause("student_speech");
        await sendStateListening(ctx.room);
      };

      const onSpeechEnd = async () => {
        if (qaActive || !speechStartTime) return;
        const durationMs = Date.now() - speechStartTime;

        // Too short → likely noise, resume immediately
        if (durationMs < MIN_SPEECH_DURATION_MS) {
          logger.info(
            `[VoiceWorker] Speech too short (${durationMs}ms), resuming lecture`
          );
          speechStartTime = null;
          playerControl.resume();
          return;
        }

        // Genuine speech ended — wait for STT FINAL. If none arrives within
        // grace period, assume STT failed and resume so lecture doesn't hang.
        logger.info(
          `[VoiceWorker] Speech ended (${durationMs}ms), awaiting transcript...`
        );
        clearResumeTimer();
        resumeTimer = setTimeout(() => {
          if (!qaActive) {
            logger.warn(
              `[VoiceWorker] No transcript within ${TRANSCRIPT_GRACE_PERIOD_MS}ms — resuming lecture`
            );
            playerControl.resume();
          }
        }, TRANSCRIPT_GRACE_PERIOD_MS);
      };

      const onTranscript = async (text) => {
        if (!text || qaActive) return;
        clearResumeTimer();

        if (!lecture || !publisherRef) {
          logger.warn("[VoiceWorker] Lecture/publisher not ready — resuming");
          playerControl.resume();
          return;
        }

        logger.info(`[VoiceWorker] → Q&A trigger: "${text}"`);
        qaActive = true;
        playerControl.enterQA();

        try {
          await handleQuestion({
            question: text,
            lecture,
            currentBlockIndex:
              lecture.blocks?.[playerControl.currentSegmentIdx] !== undefined
                ? playerControl.currentSegmentIdx
                : 0,
            publisher: publisherRef,
            room: ctx.room,
            sessionId,
          });
        } catch (err) {
          logger.error("[VoiceWorker] Q&A handler failed:", err.message);
        } finally {
          qaActive = false;
          speechStartTime = null;
          playerControl.exitQA();
          logger.info("[VoiceWorker] Q&A done — lecture resumed");
        }
      };

      audioSub = new AudioSubscriber({
        room: ctx.room,
        vad,
        stt,
        callbacks: { onSpeechStart, onSpeechEnd, onTranscript },
        // Do NOT block mic frames during playback — browser does echo
        // cancellation (echoCancellation: true is default in WebRTC).
        // Blocking here makes VAD deaf and interrupts impossible.
        shouldIgnoreFrames: () => false,
      });
      await audioSub.start();
      logger.info("[VoiceWorker] AudioSubscriber attached — waiting for student audio");

      // --- Inbound typed questions (chat box) → same Q&A path as speech ---
      // The frontend publishes {type:"question",text} on the data channel.
      // We deliberately do NOT filter by topic (it can arrive undefined
      // depending on the SFU). Control commands are parsed elsewhere and
      // are ignored here (type !== "question").
      const onQuestionData = (payload) => {
        let msg;
        try {
          msg = JSON.parse(new TextDecoder().decode(payload));
        } catch {
          return;
        }
        if (!msg || msg.type !== "question") return;
        const q = typeof msg.text === "string" ? msg.text.trim() : "";
        if (!q) return;
        logger.info(
          `[VoiceWorker] Typed question received: "${q.slice(0, 80)}"`
        );
        onTranscript(String(q).slice(0, 1000)).catch((e) =>
          logger.error(`[VoiceWorker] Typed Q&A failed: ${e.message}`)
        );
      };
      for (const e of ["dataReceived", "data_received"]) {
        try {
          ctx.room.on(e, onQuestionData);
        } catch {}
      }
      teardownTextQ = () => {
        for (const e of ["dataReceived", "data_received"]) {
          try {
            ctx.room.off?.(e, onQuestionData) ??
              ctx.room.removeListener?.(e, onQuestionData);
          } catch {}
        }
      };
    } catch (err) {
      logger.warn(`[VoiceWorker] Voice interrupt setup failed: ${err.message}`);
      logger.warn("[VoiceWorker] Continuing in playback-only mode");
    }

    // --- Wait for the student to actually be in the room ---
    // LiveKit reliable data packets are delivered ONLY to participants
    // present at publish time — there is NO backfill for late joiners.
    // The agent connects faster than the browser, so if we start
    // playback immediately every state/block_start event fires into an
    // empty room and the browser never reveals the lecture (while audio,
    // a continuous track, still plays on subscribe). Gate on join.
    await waitForStudent(
      ctx.room,
      Number(process.env.STUDENT_JOIN_TIMEOUT_MS) || 20000
    );

    // --- Run lecture playback ---
    try {
      const { publisher } = await playLecture({
        room: ctx.room,
        sessionId,
        playerControl,
        lecture, // pass enriched lecture so player skips DB reload
        // Get the publisher AS SOON as it's created (playLecture doesn't
        // resolve until the whole lecture ends) so Q&A works mid-lecture.
        onPublisher: (p) => { publisherRef = p; },
      });
      publisherRef = publisher;
    } catch (err) {
      logger.error("[VoiceWorker] Playback failed:", err.message);
    }

    // --- Cleanup ---
    try { teardownControl?.(); } catch {}
    try { teardownTextQ?.(); } catch {}
    try {
      for (const e of ["participantConnected", "participant_connected"]) {
        ctx.room.off?.(e, onLateJoin) ??
          ctx.room.removeListener?.(e, onLateJoin);
      }
    } catch {}
    try { await audioSub?.stop(); } catch {}
    try { await publisherRef?.stop(); } catch {}

    logger.info(`[VoiceWorker] Job complete for room: ${ctx.room.name}`);
  },
});

// ===========================================
// Worker Bootstrap
// ===========================================

// numIdleProcesses: number of pre-warmed worker processes kept ready for
// incoming jobs. Default is 3 — each idle process holds its own Mongo
// connection + Silero VAD model (~150MB RAM each). For low-traffic
// production, 1 is enough; scale via env var when load grows.
cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    numIdleProcesses: Number(process.env.VOICE_IDLE_PROCESSES) || 1,
  })
);
