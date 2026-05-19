// ===========================================
// Data Channel Helpers
// Send structured JSON events to clients via LiveKit data channel
// Used by the worker to communicate state events
// ===========================================

import logger from "../../utils/logger.js";

const encoder = new TextEncoder();

/**
 * Publish a JSON message to all participants in the room.
 * @livekit/rtc-node: publishData(data: Uint8Array, { reliable?, topic? }).
 *
 * If `localParticipant` is missing OR the topic'd publish throws, the
 * frontend would silently never reveal the lecture while audio still
 * plays. So we log loudly and retry once WITHOUT a topic.
 *
 * @param {Object} room      LiveKit Room instance from the worker context
 * @param {Object} payload   JSON-serializable event payload
 * @param {Object} [opts]
 * @param {boolean} [opts.reliable=true]
 * @param {string}  [opts.topic="voice-tutor"]
 */
export async function publishEvent(room, payload, opts = {}) {
  const lp = room?.localParticipant;
  if (!lp || typeof lp.publishData !== "function") {
    logger.warn(
      `[VoiceTutor] publishEvent skipped — no localParticipant (type=${payload?.type})`
    );
    return;
  }

  const reliable = opts.reliable !== false;
  const topic = opts.topic || "voice-tutor";
  const bytes = encoder.encode(JSON.stringify(payload));

  try {
    await lp.publishData(bytes, { reliable, topic });
    logger.info(
      `[VoiceTutor] sent ${payload?.type}${
        payload?.blockIndex !== undefined ? ` (block ${payload.blockIndex})` : ""
      }`
    );
  } catch (err) {
    logger.error(
      `[VoiceTutor] publishData(topic) failed for ${payload?.type}: ${err.message} — retrying without topic`
    );
    try {
      await lp.publishData(bytes, { reliable });
    } catch (err2) {
      logger.error(
        `[VoiceTutor] publishData retry also failed for ${payload?.type}: ${err2.message}`
      );
    }
  }
}

// ===========================================
// Typed Event Senders
// (use these instead of raw publishEvent to keep payloads consistent)
// ===========================================

/** Lecture playback started */
export function sendStateReading(room) {
  return publishEvent(room, { type: "state", state: "reading" });
}

/** Lecture playback completed */
export function sendStateCompleted(room) {
  return publishEvent(room, { type: "state", state: "completed" });
}

/** Lecture playback errored */
export function sendStateError(room, message) {
  return publishEvent(room, { type: "state", state: "error", error: message });
}

/** Block (or intro segment) started — frontend can scroll into view */
export function sendBlockStart(room, blockIndex) {
  return publishEvent(room, { type: "block_start", blockIndex });
}

/** Block finished */
export function sendBlockEnd(room, blockIndex) {
  return publishEvent(room, { type: "block_end", blockIndex });
}

// ===========================================
// Karaoke: per-sentence segment + word timings
// ===========================================

/**
 * A speech unit (one sentence) is about to play. The frontend
 * anchors its karaoke clock to the moment this arrives.
 */
export function sendSegmentStart(room, { segmentId, blockIndex }) {
  return publishEvent(room, { type: "segment_start", segmentId, blockIndex });
}

/**
 * Heuristic word timings for the current segment.
 * `words`: [{ blockIndex, wordIndex, word, startMs, endMs }] — offsets
 * are relative to the matching segment_start.
 */
export function sendWords(room, { segmentId, blockIndex, words }) {
  return publishEvent(room, { type: "words", segmentId, blockIndex, words });
}

// ===========================================
// Phase 2: Q&A + Listening State Events
// ===========================================

/** Student is currently speaking — lecture paused, waiting for transcript */
export function sendStateListening(room) {
  return publishEvent(room, { type: "state", state: "listening" });
}

/** Lecture is paused (user button or system) */
export function sendStatePaused(room, reason = "user") {
  return publishEvent(room, { type: "state", state: "paused", reason });
}

/** Assistant is now speaking the Q&A reply */
export function sendStateInQA(room) {
  return publishEvent(room, { type: "state", state: "in_qa" });
}

/** Transcript chunk (either student question or assistant reply) */
export function sendTranscript(room, role, text, blockIndex = -1) {
  return publishEvent(room, { type: "transcript", role, text, blockIndex });
}

/** Q&A response starting (frontend can show indicator) */
export function sendQAResponseStart(room) {
  return publishEvent(room, { type: "qa_response_start" });
}

/** Q&A response complete, lecture about to resume */
export function sendQAResponseEnd(room) {
  return publishEvent(room, { type: "qa_response_end" });
}

export default {
  publishEvent,
  sendStateReading,
  sendStateCompleted,
  sendStateError,
  sendStateListening,
  sendStatePaused,
  sendStateInQA,
  sendBlockStart,
  sendBlockEnd,
  sendSegmentStart,
  sendWords,
  sendTranscript,
  sendQAResponseStart,
  sendQAResponseEnd,
};
