// ===========================================
// Voice-Tutor Agent Prompts
// Single source for all editable prompts used by the voice tutor.
//   - buildQASystemPrompt: system prompt for in-lecture Q&A turns
//   - Adapter to the existing qaPrompts.js (kept for backward compatibility).
//
// Edit the QA_SYSTEM_TEMPLATE below to change the tutor persona, length
// targets, language rules, etc.
// ===========================================

export { buildQASystemPrompt, default as qaDefault } from "./qaPrompts.js";

/**
 * The base template the QA prompt builder uses. Re-exported here so it
 * can be tweaked in one place without touching qaPrompts.js.
 * (qaPrompts.js currently inlines this string — when you edit it there
 * the change is live; this re-export marks where to look.)
 */
export const QA_SYSTEM_TEMPLATE_NOTE =
  "Edit qaPrompts.js → buildQASystemPrompt() to change the voice tutor's QA persona.";
