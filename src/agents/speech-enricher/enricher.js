// ===========================================
// Speech Enricher Agent
// Middleware between Lecture DB fetch and Voice TTS.
// Adds inline emotion tags ([excited], [whispers], etc.)
// to text-like blocks via an LLM, then SAVES each enriched
// segment to the EnrichedSegment collection so the voice
// worker can pick them up one-by-one.
// ===========================================

import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLLM } from "../../utils/llm.js";
import { ENRICHER_SYSTEM_PROMPT } from "./prompts.js";
import { lectureToSpeechPlan } from "../voice-tutor/lectureReader.js";
import EnrichedSegment from "../../db/models/EnrichedSegment.js";
import logger from "../../utils/logger.js";

// --- LLM singleton (lazy) ---
let enricherLLM = null;
function getLLM() {
  if (!enricherLLM) {
    const model =
      process.env.SPEECH_ENRICHER_MODEL ||
      process.env.STRUCTURED_OUTPUT_MODEL ||
      "google/gemini-2.5-flash";
    enricherLLM = createLLM({ model, temperature: 0.7, streaming: false });
    logger.info(`[SpeechEnricher] LLM ready (model: ${model})`);
  }
  return enricherLLM;
}

// ===========================================
// Single-text enrichment
// ===========================================

/**
 * Enrich a single plain text string with audio tags.
 * Returns enriched text on success, original text on failure (graceful).
 */
export async function enrichText(text, opts = {}) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return text;
  }

  // Skip very short text (1–3 words) — not worth tagging
  if (text.trim().split(/\s+/).length < 4) {
    return text;
  }

  try {
    const llm = getLLM();
    const res = await llm.invoke([
      new SystemMessage({ content: ENRICHER_SYSTEM_PROMPT }),
      new HumanMessage({ content: text }),
    ]);

    const enriched =
      typeof res.content === "string"
        ? res.content
        : Array.isArray(res.content)
          ? res.content.map((c) => c.text || "").join("")
          : "";

    if (!enriched.trim()) return text;
    return enriched.trim();
  } catch (err) {
    logger.warn(`[SpeechEnricher] enrichText failed: ${err.message}`);
    return text;
  }
}

// ===========================================
// Lecture-level enrichment with DB persistence
// ===========================================

/**
 * Enrich an entire lecture into segment rows in the EnrichedSegment collection.
 *
 * Flow:
 *   1. Build full speech plan via lectureToSpeechPlan (handles all block types)
 *   2. For each segment, enrich text via LLM (parallel)
 *   3. Upsert each segment into EnrichedSegment collection (one row per segment)
 *
 * Caching: if `force` is false and segments already exist for this lecture,
 * skip enrichment and return existing rows.
 *
 * @param {Object} lecture           Lecture doc (lean)
 * @param {Object} [opts]
 * @param {boolean} [opts.force]     If true, re-enrich even if cached segments exist
 * @returns {Promise<Array>}         Ordered list of EnrichedSegment docs
 */
export async function enrichLectureToDB(lecture, opts = {}) {
  if (!lecture || !lecture.lectureId) {
    throw new Error("[SpeechEnricher] lecture with lectureId required");
  }
  const lectureId = lecture.lectureId;
  const force = !!opts.force;

  // --- Cache check: already enriched? ---
  if (!force) {
    const existing = await EnrichedSegment.find({ lectureId, status: "ready" })
      .sort({ order: 1 })
      .lean();
    if (existing.length > 0) {
      logger.info(
        `[SpeechEnricher] Using cached ${existing.length} segments for lecture ${lectureId}`
      );
      return existing;
    }
  } else {
    // Force re-enrichment — clear existing segments first
    await EnrichedSegment.deleteMany({ lectureId });
  }

  // --- Build the speech plan (already handles code/image/svg descriptions) ---
  const plan = lectureToSpeechPlan(lecture);
  logger.info(
    `[SpeechEnricher] Enriching ${plan.length} segments for lecture ${lectureId}...`
  );
  const t0 = Date.now();

  // --- Enrich each segment in parallel + persist each result ---
  const segments = await Promise.all(
    plan.map(async (seg, order) => {
      const segmentId = randomUUID();
      const originalText = seg.text;
      let enrichedText = originalText;
      let status = "ready";
      let error = null;

      try {
        enrichedText = await enrichText(originalText);
        if (!enrichedText) {
          enrichedText = originalText;
        }
      } catch (err) {
        error = err.message;
        status = "failed";
        // Still save the segment with fallback text so playback can continue
        enrichedText = originalText;
      }

      // Persist (upsert by lectureId + order to handle retries cleanly)
      await EnrichedSegment.findOneAndUpdate(
        { lectureId, order },
        {
          segmentId,
          lectureId,
          order,
          blockIndex: seg.blockIndex,
          originalText,
          enrichedText,
          status,
          error,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return { segmentId, lectureId, order, blockIndex: seg.blockIndex, enrichedText };
    })
  );

  logger.info(
    `[SpeechEnricher] Enriched + saved ${segments.length} segments in ${Date.now() - t0}ms`
  );

  // Return ordered by order
  return segments.sort((a, b) => a.order - b.order);
}

// ===========================================
// Fetch enriched segments for playback
// ===========================================

/**
 * Get ordered enriched segments for a lecture.
 * Useful for the voice player to iterate one-by-one.
 */
export async function getEnrichedSegments(lectureId) {
  return await EnrichedSegment.find({ lectureId })
    .sort({ order: 1 })
    .lean();
}

export default { enrichText, enrichLectureToDB, getEnrichedSegments };
