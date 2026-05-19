// ===========================================
// Explainer Base
// Shared lazy LLM + invoke helper for all explainer
// agents. Each explainer module formats its block into
// an input string and delegates here.
// ===========================================

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLLM } from "../../../utils/llm.js";
import { EXPLAINER_PROMPTS } from "../prompts.js";
import logger from "../../../utils/logger.js";

let explainerLLM = null;
function getLLM() {
  if (!explainerLLM) {
    const model =
      process.env.EXPLAINER_MODEL ||
      process.env.STRUCTURED_OUTPUT_MODEL ||
      "google/gemini-2.5-flash";
    explainerLLM = createLLM({ model, temperature: 0.4, streaming: false });
    logger.info(`[LectureExplainer] LLM ready (model: ${model})`);
  }
  return explainerLLM;
}

/**
 * Run a specialized explainer.
 *
 * @param {string} key       Explainer key (matches EXPLAINER_PROMPTS)
 * @param {string} input     Formatted block content for the LLM
 * @param {string} fallback  Text to return if the LLM fails/empties
 * @returns {Promise<string>}
 */
export async function runExplainer(key, input, fallback) {
  const prompt = EXPLAINER_PROMPTS[key];
  if (!prompt) return fallback;
  if (!input || !input.trim()) return fallback;

  try {
    const llm = getLLM();
    const res = await llm.invoke([
      new SystemMessage({ content: prompt }),
      new HumanMessage({ content: input }),
    ]);

    const out =
      typeof res.content === "string"
        ? res.content
        : Array.isArray(res.content)
          ? res.content.map((c) => c.text || "").join("")
          : "";

    const trimmed = out.trim();
    if (!trimmed) return fallback;
    return trimmed;
  } catch (err) {
    logger.warn(`[LectureExplainer:${key}] failed: ${err.message}`);
    return fallback;
  }
}

export default { runExplainer };
