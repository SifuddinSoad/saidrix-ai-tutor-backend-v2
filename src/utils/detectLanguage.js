// ===========================================
// Lightweight language detection (no LLM call).
// Used on the deterministic [CreateCourse] path, where the command itself
// is language-neutral, so we infer the language from the learner's recent
// natural-language messages. Returns a label the content agents understand:
// "Bengali", "Banglish", or "English".
// ===========================================

// Bengali script block.
const BENGALI_SCRIPT = /[ঀ-৿]/;

// Common romanized-Bengali (Banglish) tokens. Matched as whole words; a
// couple of hits is enough to call it Banglish (these rarely appear in
// normal English text).
const BANGLISH_TOKENS = [
  "ami", "tumi", "apni", "amar", "tomar", "kori", "korbo", "korte", "koro",
  "chai", "shikhte", "shikhbo", "bujhi", "bujhte", "kibhabe", "kemne", "kemon",
  "valo", "bhalo", "kintu", "tahole", "ekta", "gula", "guli", "kotha", "lagbe",
  "dao", "diba", "deba", "hobe", "hoye", "ase", "ache", "naki", "jonno", "diye",
];

const BANGLISH_RE = new RegExp(`\\b(${BANGLISH_TOKENS.join("|")})\\b`, "gi");

export function detectLanguage(text) {
  const s = String(text || "");
  if (!s.trim()) return "English";

  if (BENGALI_SCRIPT.test(s)) return "Bengali";

  const hits = (s.match(BANGLISH_RE) || []).length;
  if (hits >= 2) return "Banglish";

  return "English";
}

export default { detectLanguage };
