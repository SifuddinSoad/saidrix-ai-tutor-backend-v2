// ===========================================
// Sentence Splitting (shared)
// Single source of truth for sentence boundaries so the
// lecture player and the Q&A streamer chunk text identically
// (each sentence is one TTS + karaoke alignment unit).
//
// Punctuation set matches the original qa.js regex plus the
// ellipsis used by the divider block: . ! ? । ؟ …
// ===========================================

// One sentence: text up to (and including) a run of terminal
// punctuation, plus any closing quote/bracket, plus trailing space.
const SENTENCE_RE = /[^.!?।؟…]*[.!?।؟…]+["'’”)\]]*\s*/gu;

/**
 * Split a complete string into sentences. A trailing fragment
 * with no terminal punctuation is returned as its own sentence
 * (so headings / short blocks without a period still play).
 *
 * @param {string} text
 * @returns {string[]} non-empty, trimmed sentences (input order)
 */
export function splitSentences(text) {
  if (typeof text !== "string") return [];
  const src = text;
  if (src.trim().length === 0) return [];

  const out = [];
  let lastIndex = 0;
  for (const m of src.matchAll(SENTENCE_RE)) {
    const piece = m[0].trim();
    if (piece.length > 0) out.push(piece);
    lastIndex = m.index + m[0].length;
  }
  const tail = src.slice(lastIndex).trim();
  if (tail.length > 0) out.push(tail);

  // Guard: a string with no terminal punctuation at all still
  // yields one sentence (the whole thing).
  if (out.length === 0) {
    const whole = src.trim();
    if (whole.length > 0) out.push(whole);
  }
  return out;
}

/**
 * Pull the FIRST complete sentence off the front of a growing
 * buffer (used by the Q&A LLM stream). Returns null while the
 * buffer has no complete sentence yet.
 *
 * @param {string} buffer
 * @returns {{ sentence: string, rest: string } | null}
 */
export function takeLeadingSentence(buffer) {
  if (typeof buffer !== "string" || buffer.length === 0) return null;
  const m = buffer.match(/^[^.!?।؟…]*[.!?।؟…]+["'’”)\]]*\s/u);
  if (!m) return null;
  return {
    sentence: m[0].trim(),
    rest: buffer.slice(m[0].length),
  };
}

export default { splitSentences, takeLeadingSentence };
