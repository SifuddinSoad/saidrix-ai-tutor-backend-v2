// ===========================================
// Speak Unit (shared by lecture + Q&A)
// One sentence = one karaoke unit:
//   1. Buffer ALL TTS PCM (so we know the exact duration)
//   2. Estimate heuristic word timings from the known text
//   3. Publish segment_start + words, then push the buffered PCM
//
// Split into prepare/emit so the lecture player can prefetch
// sentence N+1 (TTS + timings) while sentence N is playing.
// ===========================================

import { streamTTS } from "./openaiTTS.js";
import { estimateWordTimings } from "./wordTimings.js";
import { sendSegmentStart, sendWords } from "./dataChannel.js";
import { stripTags } from "../speech-enricher/tagsCatalog.js";
import logger from "../../utils/logger.js";

const SAMPLE_RATE = 16000; // matches AudioPublisher
const FRAME_BYTES = (SAMPLE_RATE / 50) * 2; // 20ms mono 16-bit = 640 bytes

/**
 * Run TTS for one sentence, fully buffering the audio, and
 * compute heuristic word timings. No room/publisher needed —
 * safe to call ahead of time (prefetch).
 *
 * @param {string} text
 * @param {Object} [opts]
 * @param {number} [opts.blockIndex=-1]
 * @param {number} [opts.baseWordIndex=0]
 * @param {Object} [opts.ttsOpts]
 * @returns {Promise<{text,spoken,pcm:Buffer,durationMs:number,words:Array}>}
 */
export async function prepareUnit(text, opts = {}) {
  const blockIndex = opts.blockIndex ?? -1;
  const baseWordIndex = opts.baseWordIndex ?? 0;

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of streamTTS(text, opts.ttsOpts || {})) {
    if (chunk && chunk.pcm && chunk.pcm.length > 0) {
      chunks.push(chunk.pcm);
      totalBytes += chunk.pcm.length;
    }
  }

  // Dedicated (non-pooled) buffer — Buffer.concat can return
  // pool-backed memory for short sentences, which a concurrent
  // prefetch's allocations could overwrite before playback.
  const pcm = Buffer.allocUnsafeSlow(totalBytes);
  let p = 0;
  for (const c of chunks) {
    c.copy(pcm, p);
    p += c.length;
  }
  const durationMs = (totalBytes / 2 / SAMPLE_RATE) * 1000;
  const spoken = stripTags(text);
  const words = estimateWordTimings(spoken, durationMs, {
    blockIndex,
    baseWordIndex,
  });

  return { text, spoken, pcm, durationMs, words };
}

/**
 * Publish the prepared unit: anchor event → word timings →
 * buffered PCM (in 20ms frames, honoring pause/abort).
 *
 * @param {Object} args
 * @param {Object} args.prepared       Result of prepareUnit()
 * @param {number} args.segmentId      Monotonic per-session id
 * @param {number} args.blockIndex
 * @param {Object} args.publisher      AudioPublisher
 * @param {Object} args.room           LiveKit Room
 * @param {Object} [args.playerControl] Pause/abort bus (lecture only)
 * @returns {Promise<boolean>} false if aborted mid-unit
 */
export async function emitUnit({
  prepared,
  segmentId,
  blockIndex,
  publisher,
  room,
  playerControl,
}) {
  if (!prepared || !prepared.pcm || prepared.pcm.length === 0) return true;

  if (room) {
    await sendSegmentStart(room, { segmentId, blockIndex });
    await sendWords(room, { segmentId, blockIndex, words: prepared.words });
  }

  const pcm = prepared.pcm;
  for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
    // Abort (do NOT block) the moment playback is no longer active:
    // paused / Q&A (state !== PLAYING) or skip/repeat/jump
    // (isAborting). The consumer decides whether to replay this
    // unit (pause/Q&A) or drop it (skip/repeat/jump).
    if (
      playerControl &&
      (!playerControl.isPlaying() || playerControl.isAborting())
    ) {
      return false;
    }
    const end = Math.min(off + FRAME_BYTES, pcm.length);
    // Copy each frame into a DEDICATED, non-pooled buffer. pushPCM
    // hands an Int16Array view straight to LiveKit's native
    // captureFrame; a subarray view would alias the shared Buffer
    // pool, which concurrent prefetch allocations overwrite
    // mid-flight → static/noise instead of speech.
    const frame = Buffer.allocUnsafeSlow(end - off);
    pcm.copy(frame, 0, off, end);
    await publisher.pushPCM(frame);
  }
  return true;
}

/**
 * Convenience: prepare + emit one sentence (Q&A path; lecture
 * uses prepare/emit separately so it can prefetch).
 */
export async function speakUnit({
  text,
  segmentId,
  blockIndex = -1,
  baseWordIndex = 0,
  publisher,
  room,
  playerControl,
  ttsOpts,
}) {
  try {
    const prepared = await prepareUnit(text, {
      blockIndex,
      baseWordIndex,
      ttsOpts,
    });
    await emitUnit({
      prepared,
      segmentId,
      blockIndex,
      publisher,
      room,
      playerControl,
    });
    return prepared;
  } catch (err) {
    logger.error(`[speakUnit] failed (block ${blockIndex}): ${err.message}`);
    return null;
  }
}

export default { prepareUnit, emitUnit, speakUnit };
