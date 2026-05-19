// ===========================================
// Heuristic Word Timings
// gpt-4o-mini-tts returns no alignment, so we estimate
// per-word timings from the KNOWN spoken text + the EXACT
// audio duration (derived from the PCM byte count).
//
// Words are distributed across the duration weighted by
// character length, with extra dwell after punctuation so
// the last word of a sentence/clause stays highlighted
// through the natural spoken pause.
//
// Output schema is identical to alignmentToWords.js so the
// frontend consumes one format regardless of source.
// ===========================================

import { TAG_RE } from "../speech-enricher/tagsCatalog.js";

// Extra weight (in "character-equivalent" units) granted to a
// word that ends a sentence / clause. The pause is folded into
// the preceding word so coverage stays contiguous (no blank
// gaps mid-caption) — the word simply lingers through the pause.
const SENTENCE_PAUSE_WEIGHT = 6;
const CLAUSE_PAUSE_WEIGHT = 3;

const SENTENCE_END_RE = /[.!?।؟…]["'’”)\]]*$/;
const CLAUSE_END_RE = /[,;:]["'’”)\]]*$/;

/**
 * Estimate word-level timings for spoken text over a known duration.
 *
 * @param {string} spokenText            Exact text the TTS spoke.
 * @param {number} durationMs            Exact audio duration (ms).
 * @param {Object} [opts]
 * @param {number} [opts.blockIndex=-1]  Lecture block index (frontend reveal key).
 * @param {number} [opts.baseWordIndex=0] First wordIndex (for multi-segment runs).
 * @returns {Array<{blockIndex:number, wordIndex:number, word:string, startMs:number, endMs:number}>}
 */
export function estimateWordTimings(spokenText, durationMs, opts = {}) {
  const blockIndex = opts.blockIndex ?? -1;
  const baseWordIndex = opts.baseWordIndex ?? 0;

  if (typeof spokenText !== "string" || !(durationMs > 0)) return [];

  // [tags] are never spoken visibly — drop them before tokenizing.
  const clean = spokenText.replace(TAG_RE, " ");
  const tokens = clean.split(/\s+/).filter((t) => t.trim().length > 0);
  if (tokens.length === 0) return [];

  // --- Weight each token: length + trailing-pause dwell ---
  const weights = tokens.map((tok) => {
    let w = Math.max(1, tok.length);
    if (SENTENCE_END_RE.test(tok)) w += SENTENCE_PAUSE_WEIGHT;
    else if (CLAUSE_END_RE.test(tok)) w += CLAUSE_PAUSE_WEIGHT;
    return w;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const msPerUnit = durationMs / totalWeight;

  // --- Distribute contiguously across [0, durationMs] ---
  const words = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const startMs = Math.round(cursor);
    cursor += weights[i] * msPerUnit;
    // Kill rounding drift: the final word ends exactly at durationMs.
    const endMs =
      i === tokens.length - 1 ? Math.round(durationMs) : Math.round(cursor);
    words.push({
      blockIndex,
      wordIndex: baseWordIndex + i,
      word: tokens[i],
      startMs,
      endMs,
    });
  }

  return words;
}

export default estimateWordTimings;
