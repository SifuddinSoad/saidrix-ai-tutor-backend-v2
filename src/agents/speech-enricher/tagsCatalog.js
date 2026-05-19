// ===========================================
// Audio Tags Catalog
// ElevenLabs v3 supported emotion/delivery tags.
// Single source of truth for prompts + validation.
// ===========================================

/**
 * Allowed inline emotion + delivery tags.
 * ElevenLabs v3 model interprets these to modulate voice.
 * Reference: ElevenLabs Eleven v3 documentation.
 */
export const ALLOWED_TAGS = [
  // --- Emotions ---
  "surprised",
  "excited",
  "happy",
  "sad",
  "angry",
  "thoughtful",
  "nervous",
  "calm",
  "confident",
  "warm",
  "playful",
  "serious",
  "gentle",
  "curious",
  "sarcastic",

  // --- Vocal effects ---
  "whispers",
  "shouts",
  "laughs",
  "giggle",
  "sighs",
  "deep breath",
  "crying",
  "chuckles",
  "yawns",
  "clears throat",

  // --- Pacing ---
  "pause",
  "short pause",
  "long pause",
  "slow",
  "fast",
];

/**
 * Regex to match any `[tag]` style audio tag in text.
 * Used to strip from karaoke word events.
 */
export const TAG_RE = /\[[^\[\]\n]+\]/g;

/**
 * Check whether a string is a valid tag from our catalog.
 * Case-insensitive, ignores extra whitespace.
 */
export function isAllowedTag(tag) {
  if (!tag) return false;
  const cleaned = tag.replace(/^\[|\]$/g, "").trim().toLowerCase();
  return ALLOWED_TAGS.includes(cleaned);
}

/**
 * Strip all `[tag]` occurrences from text — used when computing visible
 * transcripts or fallback text for non-v3 models.
 */
export function stripTags(text) {
  if (!text) return "";
  return String(text).replace(TAG_RE, "").replace(/\s+/g, " ").trim();
}

export default { ALLOWED_TAGS, TAG_RE, isAllowedTag, stripTags };
