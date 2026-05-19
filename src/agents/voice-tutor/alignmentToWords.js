// ===========================================
// Alignment to Word Events
// Converts ElevenLabs char-level alignment to word events
// for karaoke sync.
//
// Phase 3: Skip ElevenLabs v3 audio tags ([excited], [whispers], ...)
// — they appear in alignment but aren't spoken visibly, so we must
// exclude them from word events.
// ===========================================

/**
 * Convert ElevenLabs character-level alignment to word-level events,
 * skipping any `[tag]` segments (audio tags).
 *
 * @param {Object} alignment
 * @param {string[]} alignment.chars
 * @param {number[]} alignment.charStartTimesMs
 * @param {number[]} alignment.charDurationsMs
 * @param {number} blockIndex
 * @param {number} baseOffsetMs
 * @param {number} startWordIndex
 * @returns {Array<{blockIndex, wordIndex, word, startMs, endMs}>}
 */
export function alignmentToWords(
  alignment,
  blockIndex,
  baseOffsetMs = 0,
  startWordIndex = 0
) {
  if (
    !alignment ||
    !Array.isArray(alignment.chars) ||
    !Array.isArray(alignment.charStartTimesMs) ||
    !Array.isArray(alignment.charDurationsMs)
  ) {
    return [];
  }

  const { chars, charStartTimesMs, charDurationsMs } = alignment;
  const words = [];

  let buffer = [];
  let wordStart = null;
  let wordEnd = 0;
  let wordIndex = startWordIndex;

  // True while we're inside a `[tag]` — skip chars
  let insideTag = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const word = buffer.join("");
    if (word.trim().length === 0) {
      buffer = [];
      wordStart = null;
      return;
    }
    words.push({
      blockIndex,
      wordIndex: wordIndex++,
      word,
      startMs: (wordStart ?? 0) + baseOffsetMs,
      endMs: wordEnd + baseOffsetMs,
    });
    buffer = [];
    wordStart = null;
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const startMs = charStartTimesMs[i] ?? 0;
    const durMs = charDurationsMs[i] ?? 0;

    // --- Tag handling: skip everything between '[' and ']' (inclusive) ---
    if (ch === "[") {
      // Flush any word in progress before the tag
      flush();
      insideTag = true;
      continue;
    }
    if (ch === "]") {
      insideTag = false;
      continue;
    }
    if (insideTag) {
      continue;
    }

    // --- Normal char processing ---
    if (/\s/.test(ch)) {
      flush();
    } else {
      if (wordStart === null) wordStart = startMs;
      buffer.push(ch);
      wordEnd = startMs + durMs;
    }
  }

  flush();
  return words;
}

export default alignmentToWords;
