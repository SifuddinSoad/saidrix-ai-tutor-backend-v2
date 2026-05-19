// ===========================================
// extractAskBlocks — pulls structured clarifying-question prompts out
// of the assistant's final response.
//
// Fence-INDEPENDENT: it scans the whole text for any balanced JSON
// object that contains a `questions: [...]` array — whether it is
// wrapped in ```ask / ```json / bare ``` or has no fence at all, and
// even when the object has nested objects (options). This is robust to
// the model forgetting/garbling the code fence.
//
// Each parsed prompt gets a stable UUID `id` so the client can track
// per-prompt answer state across reloads.
// ===========================================

import { randomUUID } from "node:crypto";
import logger from "../../utils/logger.js";

function parsePromptsJSON(raw) {
  let parsed;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  const list = Array.isArray(parsed?.questions) ? parsed.questions : null;
  if (!list || list.length === 0) return null;

  const out = [];
  for (const q of list) {
    if (!q || typeof q.question !== "string" || !Array.isArray(q.options)) continue;
    const options = q.options
      .map((opt) => {
        if (typeof opt === "string") return { label: opt, description: "" };
        if (opt && typeof opt.label === "string") {
          return {
            label: opt.label,
            description: typeof opt.description === "string" ? opt.description : "",
          };
        }
        return null;
      })
      .filter(Boolean);
    if (options.length === 0) continue;

    out.push({
      id: randomUUID(),
      header: typeof q.header === "string" ? q.header : "",
      question: q.question,
      multiSelect: !!q.multiSelect,
      options,
      answered: false,
    });
  }
  return out.length > 0 ? out : null;
}

// Scan for every balanced { ... } object (string-aware so braces inside
// JSON string values don't break the depth count). Returns spans in
// source order, outermost objects only.
function findBalancedObjects(text) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          spans.push({ start: i, end: j + 1, raw: text.slice(i, j + 1) });
          i = j; // skip past this object (outermost only)
          break;
        }
      }
    }
  }
  return spans;
}

export function extractAskBlocks(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { cleanedText: text || "", prompts: [] };
  }

  const prompts = [];
  const removeSpans = [];

  for (const span of findBalancedObjects(text)) {
    if (!span.raw.includes("questions")) continue;
    try {
      const parsed = parsePromptsJSON(span.raw);
      if (parsed && parsed.length > 0) {
        prompts.push(...parsed);
        removeSpans.push(span);
      }
    } catch (err) {
      logger.warn(`[extractAskBlocks] parse failed: ${err.message}`);
    }
  }

  let cleanedText = text;
  if (removeSpans.length > 0) {
    // Remove from the end so earlier indices stay valid.
    removeSpans.sort((a, b) => b.start - a.start);
    for (const s of removeSpans) {
      cleanedText = cleanedText.slice(0, s.start) + cleanedText.slice(s.end);
    }
    // Strip now-empty fenced wrappers / stray fences left behind.
    cleanedText = cleanedText
      .replace(/```(?:ask|json)?\s*```/gi, "")
      .replace(/```(?:ask|json)?\s*$/gi, "")
      .replace(/^\s*```\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return { cleanedText, prompts };
}

export default extractAskBlocks;
