// ===========================================
// Language directive helper
// Single source of truth for the "write in the user's language, keep code
// + technical terms in English" instruction injected into every content
// agent's prompt (course-maker, lecture-maker, explainers, project-maker).
//
// Language is AUTO-DETECTED from the user's chat and stored on the Course /
// Lecture — there is no manual setting. English (or unset) returns an empty
// string so existing English behavior is unchanged (no regression).
// ===========================================

// Treat these as "no directive needed" — the model's default is English.
const DEFAULT_LANG = /^(english|en|en-us|en-gb|default|auto|)$/i;

function normalize(language) {
  return String(language || "").trim();
}

// Strong directive for agents that GENERATE fresh content (lectures,
// course outlines, spoken explanations). Empty for English/unset.
export function languageDirective(language) {
  const lang = normalize(language);
  if (DEFAULT_LANG.test(lang)) return "";
  return (
    `\n\n## Language (MANDATORY)\n` +
    `Write ALL prose, explanations, headings, narration, and user-facing text in ${lang}. ` +
    `Keep all code exactly as-is (English identifiers, keywords, syntax) and keep CLI commands, ` +
    `file paths, URLs, and established technical terms in English — do NOT translate or transliterate them. ` +
    `Write naturally, the way a fluent bilingual instructor explains technical topics in ${lang}.`
  );
}

// Lighter note for agents that only TRANSFORM existing text (the tag-only
// speech enricher): preserve the language, never translate. Empty for
// English/unset.
export function preserveLanguageNote(language) {
  const lang = normalize(language);
  if (DEFAULT_LANG.test(lang)) return "";
  return (
    `\n\nThe input text is written in ${lang}. Preserve its language exactly — ` +
    `never translate or rewrite it into another language. Keep code and technical terms in English.`
  );
}

export default { languageDirective, preserveLanguageNote };
