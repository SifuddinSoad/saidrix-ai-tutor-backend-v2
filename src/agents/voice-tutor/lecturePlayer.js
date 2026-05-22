// ===========================================
// Lecture Player (Phase 2)
// Orchestrates lecture playback with control support:
//   - pause/resume via PlayerControl
//   - skip / repeat / jump segment flags
//   - Q&A pause hold (state === IN_QA)
// ===========================================

import Lecture from "../../db/models/Lecture.js";
import VoiceSession from "../../db/models/VoiceSession.js";
import LectureProgress from "../../db/models/LectureProgress.js";
import { lectureToSpeechPlan } from "./lectureReader.js";
import { splitSentences } from "./textSplit.js";
import { prepareUnit, emitUnit } from "./speakUnit.js";
import { SegmentQueue, QUEUE_CLOSED } from "./segmentQueue.js";
import EnrichedSegment from "../../db/models/EnrichedSegment.js";
import { PIPELINE_VERSION } from "../lecture-explainer/pipelineVersion.js";
import { AudioPublisher } from "./audioPublisher.js";
import {
  sendStateReading,
  sendStateCompleted,
  sendStateError,
  sendBlockStart,
  sendBlockEnd,
  sendTranscript,
} from "./dataChannel.js";
import { PlayerControl } from "./playerControl.js";
import { completeLecture } from "../../services/progress.service.js";
import logger from "../../utils/logger.js";

/**
 * Play a lecture into a LiveKit room.
 *
 * @param {Object} ctx
 * @param {Object} ctx.room                       LiveKit Room
 * @param {string} ctx.sessionId                  VoiceSession ID
 * @param {PlayerControl} [ctx.playerControl]     Optional control bus (Phase 2)
 * @param {Object} [ctx.lecture]                  Optional preloaded (enriched) lecture
 * @returns {Promise<{publisher: AudioPublisher, lecture: Object}>}
 */
export async function playLecture(ctx) {
  const { room, sessionId } = ctx;
  const playerControl = ctx.playerControl || new PlayerControl();

  // --- Load session + lecture (use enriched lecture from caller if provided) ---
  const session = await VoiceSession.findOne({ sessionId });
  if (!session) throw new Error(`VoiceSession ${sessionId} not found`);

  const lecture =
    ctx.lecture ||
    (await Lecture.findOne({ lectureId: session.lectureId }).lean());
  if (!lecture) throw new Error(`Lecture ${session.lectureId} not found`);

  await VoiceSession.updateOne(
    { sessionId },
    { state: "active", agentJoined: true, startedAt: new Date() }
  );

  logger.info(`[LecturePlayer] Starting playback for session ${sessionId}`);

  // --- Audio publisher (single track for whole session, incl. Q&A) ---
  const publisher = new AudioPublisher(room);
  await publisher.start();

  // The instant a question/pause begins, drop any lecture audio still
  // buffered in the native AudioSource so it doesn't bleed over the Q&A
  // reply (the JS loop may be mid-sentence; the native buffer holds it).
  playerControl.on("pause", () => publisher.clearQueue());
  playerControl.on("qa_start", () => publisher.clearQueue());

  // Hand the publisher to the caller NOW — playLecture only resolves once
  // the WHOLE lecture finishes, but the worker needs the publisher during
  // playback so mid-lecture Q&A (voice or typed) can actually speak.
  if (typeof ctx.onPublisher === "function") {
    try {
      ctx.onPublisher(publisher);
    } catch {
      /* noop */
    }
  }

  // --- Progressive speech plan ---
  // The deterministic raw plan defines segment order/count and the
  // per-segment fallback text. Each segment's final voice text is
  // resolved from the EnrichedSegment collection as it becomes ready
  // (the explainer pipeline fills it in the background), so playback
  // can start with only the first few blocks enriched and naturally
  // flow into the rest as they complete.
  const expected = lectureToSpeechPlan(lecture);
  const total = expected.length;
  const lectureId = lecture.lectureId;
  logger.info(
    `[LecturePlayer] Progressive plan: ${total} segments (enriched on demand)`
  );

  // Per-segment wait before falling back to raw text. Kept SHORT so a
  // slow/failed enrichment can't freeze playback (and therefore the
  // block_start reveal on the frontend) for a minute+ per segment.
  // Enriched text is still preferred whenever it's ready in time.
  const SEGMENT_WAIT_MS = Number(process.env.SEGMENT_WAIT_MS) || 1000;
  const SEGMENT_WAIT_MAX =
    Number(process.env.SEGMENT_WAIT_MAX_ATTEMPTS) || 10; // ~10s cap

  async function resolveSegment(order) {
    const raw = expected[order];
    for (let attempt = 0; attempt <= SEGMENT_WAIT_MAX; attempt++) {
      // Only accept segments produced by the CURRENT pipeline version —
      // stale rows (old expanded headings) are ignored so playback uses
      // fresh raw text until re-enrichment catches up.
      const seg = await EnrichedSegment.findOne({
        lectureId,
        order,
        status: "ready",
        "metadata.pipelineVersion": PIPELINE_VERSION,
      }).lean();
      if (seg && seg.enrichedText) {
        if (attempt > 0) {
          logger.info(
            `[LecturePlayer] Segment ${order} enriched after ${attempt}s wait`
          );
        }
        return { blockIndex: raw.blockIndex, text: seg.enrichedText };
      }
      // If enrichment of this segment failed, stop waiting — use raw.
      const failed = await EnrichedSegment.findOne({
        lectureId,
        order,
        status: "failed",
      }).lean();
      if (failed) {
        logger.warn(
          `[LecturePlayer] Segment ${order} enrichment FAILED — using raw text`
        );
        break;
      }
      if (attempt < SEGMENT_WAIT_MAX) {
        await new Promise((r) => setTimeout(r, SEGMENT_WAIT_MS));
      }
    }
    // Graceful fallback — never hang playback.
    logger.warn(
      `[LecturePlayer] Segment ${order} not enriched in time — using raw text (playback continues)`
    );
    return { blockIndex: raw.blockIndex, text: raw.text };
  }

  await sendStateReading(room);

  // Monotonic karaoke segment id (one per spoken sentence) — the
  // frontend re-anchors its caption clock on every segment_start.
  const segCounter = { n: 0 };

  // Resume: voice.routes.js writes the requested start block into
  // VoiceSession.currentBlockIndex at creation time. Find the first
  // segment whose blockIndex >= startBlockIdx so we skip past completed
  // blocks. -2/-1 (title/summary) segments are ALWAYS played at start
  // if we're resuming from block 0; otherwise they're skipped too.
  const startBlockIdx = Math.max(0, Number(session.currentBlockIndex) || 0);
  const sessionUserId = session.userId;
  if (!sessionUserId) {
    logger.warn(
      `[LecturePlayer] VoiceSession ${sessionId} has no userId — LectureProgress writes will be skipped`
    );
  }

  function findResumeSegIdx(startBlock) {
    if (startBlock <= 0) return 0;
    for (let i = 0; i < expected.length; i++) {
      if ((expected[i].blockIndex ?? -1) >= startBlock) return i;
    }
    return expected.length - 1;
  }

  async function saveProgress(blockIndex, { completed = false } = {}) {
    if (!sessionUserId) return;
    try {
      await LectureProgress.findOneAndUpdate(
        { userId: sessionUserId, lectureId },
        {
          $set: {
            lastBlockIndex: blockIndex,
            totalBlocks: lecture.blocks?.length || 0,
            ...(completed ? { completed: true, completedAt: new Date() } : {}),
          },
          $setOnInsert: { userId: sessionUserId, lectureId },
        },
        { upsert: true }
      );
    } catch (err) {
      logger.warn(`[LecturePlayer] LectureProgress save failed: ${err.message}`);
    }

    // On completion, also record the authoritative topic completion
    // (awards XP + unlocks the next lecture). Idempotent via unique index,
    // so replaying a finished lecture is a no-op. Independent of the
    // frontend's own completeLecture call so the unlock never depends on
    // the client staying on the page until the end.
    if (completed && lecture.courseId && lecture.location) {
      const l = lecture.location;
      try {
        await completeLecture(sessionUserId, lecture.courseId, {
          chapter: l.chapter_index,
          module: l.module_index,
          sub_module: l.sub_module_index,
          topic: l.topic_index,
        });
      } catch (err) {
        logger.warn(
          `[LecturePlayer] LectureCompletion save failed: ${err.message}`
        );
      }
    }
  }

  try {
    // --- Iterate segments with index pointer (so we can jump/repeat) ---
    let segIdx = findResumeSegIdx(startBlockIdx);
    if (segIdx > 0) {
      logger.info(
        `[LecturePlayer] Resuming session ${sessionId} from segment ${segIdx} (block ≥ ${startBlockIdx})`
      );
    }
    while (segIdx < total) {
      // Block on pause / Q&A before starting a new segment
      await playerControl.waitIfPaused();
      if (playerControl.state === "completed") break;

      const segment = await resolveSegment(segIdx);
      const { blockIndex, text } = segment;

      playerControl.setSegmentIdx(segIdx);
      // Track the real Lecture.blocks index so a late/re-joining browser
      // can be re-synced to the current block (reliable data has no
      // backfill — see worker.js reemitSync).
      playerControl.currentBlockIndex = blockIndex;

      logger.info(
        `[LecturePlayer] Segment ${segIdx + 1}/${total} (block ${blockIndex})`
      );

      await sendBlockStart(room, blockIndex);

      // Run TTS for this segment (may abort early on skip/repeat/jump)
      await playSegment({
        text,
        blockIndex,
        publisher,
        room,
        playerControl,
        segCounter,
      });

      await sendBlockEnd(room, blockIndex);

      // --- Consume control flags after segment ---
      if (playerControl.jumpToSegment !== null) {
        const target = playerControl.jumpToSegment;
        playerControl.clearSegmentFlags();
        if (target >= 0 && target < total) {
          segIdx = target;
          continue;
        }
      } else if (playerControl.shouldRepeat) {
        playerControl.clearSegmentFlags();
        // segIdx stays the same → segment plays again
        continue;
      } else if (playerControl.shouldSkip) {
        playerControl.clearSegmentFlags();
        // advance normally
      } else {
        playerControl.clearSegmentFlags();
      }

      // Update checkpoint (per-session AND per-user resume doc)
      if (blockIndex >= 0) {
        await VoiceSession.updateOne(
          { sessionId },
          { currentBlockIndex: blockIndex, currentCharOffset: 0 }
        );
        await saveProgress(blockIndex);
      }

      segIdx += 1;
    }

    // --- Done ---
    playerControl.complete();
    await sendStateCompleted(room);
    await VoiceSession.updateOne(
      { sessionId },
      { state: "completed", endedAt: new Date() }
    );
    const lastBlock = (lecture.blocks?.length || 1) - 1;
    await saveProgress(lastBlock, { completed: true });
    logger.info(`[LecturePlayer] Completed session ${sessionId}`);
  } catch (err) {
    logger.error("[LecturePlayer] Fatal error:", err.message);
    await sendStateError(room, err.message);
    await VoiceSession.updateOne(
      { sessionId },
      { state: "failed", endedAt: new Date(), error: err.message }
    );
    throw err;
  }

  // NOTE: don't stop the publisher here — the worker may still need it
  // for Q&A audio. Worker is responsible for tearing down on shutdown.
  return { publisher, lecture };
}

// ===========================================
// Play a single segment with pause/abort support
// ===========================================

async function playSegment({
  text,
  blockIndex,
  publisher,
  room,
  playerControl,
  segCounter,
}) {
  // Send plain text to transcript panel before audio starts
  await sendTranscript(room, "assistant", text, blockIndex);

  const sentences = splitSentences(text);
  if (sentences.length === 0) return;

  // One sentence = one karaoke unit. A bounded queue decouples TTS
  // production from playback: the producer prepares sentences ahead
  // (cap 2) and BLOCKS when full — so while the consumer is held for
  // Q&A/pause, no extra TTS is fetched and prepared units stay in
  // memory for an instant replay.
  const queue = new SegmentQueue(2);

  (async () => {
    for (const s of sentences) {
      if (playerControl.isAborting()) break;
      // Single retry with 500ms backoff for transient network drops
      // ("terminated" / ECONNRESET / fetch failed / aborted). These are
      // the bulk of TTS failures and a quick re-fetch usually clears
      // them. Hard failures still fall through to the skip branch.
      let prepared = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          prepared = await prepareUnit(s, { blockIndex });
          break;
        } catch (err) {
          const msg = err?.message || String(err);
          const transient = /terminated|ECONNRESET|fetch failed|aborted|socket hang up/i.test(msg);
          const isLast = attempt === 1;
          if (isLast || !transient) {
            logger.error(
              `[LecturePlayer] TTS prepare failed (block ${blockIndex}, attempt ${attempt + 1}): ${msg}`
            );
            break;
          }
          logger.warn(
            `[LecturePlayer] TTS prepare retry (block ${blockIndex}): ${msg}`
          );
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!prepared) continue; // skip this sentence, keep playback alive
      const ok = await queue.push(prepared);
      if (!ok) break; // queue closed (segment aborted)
    }
    queue.close();
  })().catch(() => {});

  try {
    // `interrupted` holds the unit cut off by a pause/Q&A so it can be
    // replayed from its start once playback resumes.
    let interrupted = null;
    for (;;) {
      await playerControl.waitIfPaused();
      if (playerControl.isAborting()) break;

      let unit = interrupted;
      if (!unit) {
        unit = await queue.shift();
        if (unit === QUEUE_CLOSED) break;
      }

      const ok = await emitUnit({
        prepared: unit,
        segmentId: segCounter.n++,
        blockIndex,
        publisher,
        room,
        playerControl,
      });

      if (ok) {
        interrupted = null;
        continue;
      }

      // emitUnit aborted. Two cases:
      if (playerControl.isAborting()) break; // skip/repeat/jump/completed
      // Paused / Q&A: remember this unit, wait for resume, replay it
      // from the start (PCM already buffered — instant, re-anchors
      // karaoke via a fresh segment_start).
      interrupted = unit;
    }
  } finally {
    // Stop the producer no matter how we exit (close wakes a blocked
    // push; clear frees a producer waiting on a full queue). Any
    // in-flight prepareUnit resolves harmlessly against the closed
    // queue — no need to await it (keeps skip/jump responsive).
    queue.close();
    queue.clear();
  }
}

export default { playLecture };
