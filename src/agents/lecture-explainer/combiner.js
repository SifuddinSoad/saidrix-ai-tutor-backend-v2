// ===========================================
// Combiner & Enhancer
// Takes a specialist explainer's deep explanation and
// rewrites it as smooth, conversational voice narration
// with ElevenLabs audio tags. Tag catalog is reused from
// the speech-enricher (single source of truth).
// ===========================================

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLLM } from "../../utils/llm.js";
import { ALLOWED_TAGS } from "../speech-enricher/tagsCatalog.js";
import { buildCombinerPrompt } from "./prompts.js";
import logger from "../../utils/logger.js";

let combinerLLM = null;
function getLLM() {
  if (!combinerLLM) {
    const model =
      process.env.COMBINER_MODEL ||
      process.env.SPEECH_ENRICHER_MODEL ||
      process.env.STRUCTURED_OUTPUT_MODEL ||
      "google/gemini-2.5-flash";
    combinerLLM = createLLM({ model, temperature: 0.7, streaming: false });
    logger.info(`[LectureCombiner] LLM ready (model: ${model})`);
  }
  return combinerLLM;
}

const COMBINER_PROMPT = buildCombinerPrompt(ALLOWED_TAGS);

/**
 * Enhance a deep explanation into final spoken narration.
 *
 * @param {string} explanation  Specialist explainer output
 * @param {Object} [ctx]
 * @param {boolean} [ctx.isFirst]
 * @param {boolean} [ctx.isLast]
 * @param {string}  [ctx.lectureTitle]
 * @returns {Promise<string>}   Toned narration (or explanation on failure)
 */
export async function enhance(explanation, ctx = {}) {
  if (!explanation || !explanation.trim()) return explanation;

  const meta = [
    `Lecture: ${ctx.lectureTitle || "(untitled)"}`,
    `Position: ${ctx.isFirst ? "FIRST segment" : ctx.isLast ? "LAST segment" : "middle segment"}`,
  ].join("\n");

  try {
    const llm = getLLM();
    const res = await llm.invoke([
      new SystemMessage({ content: COMBINER_PROMPT }),
      new HumanMessage({ content: `${meta}\n\nExplanation:\n${explanation}` }),
    ]);

    const out =
      typeof res.content === "string"
        ? res.content
        : Array.isArray(res.content)
          ? res.content.map((c) => c.text || "").join("")
          : "";

    const trimmed = out.trim();
    return trimmed || explanation;
  } catch (err) {
    logger.warn(`[LectureCombiner] enhance failed: ${err.message}`);
    return explanation;
  }
}

export default { enhance };
