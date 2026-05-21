// ===========================================
// Project Reviewer Agent
// Stage 1: batch each group of files through a structured-output LLM
//          call that returns issues.
// Stage 2: aggregate, deterministically score, then ask the LLM for a
//          short student-facing summary.
// ===========================================

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { randomUUID } from "crypto";
import { createLLM } from "../../utils/llm.js";
import { BATCH_SIZE } from "../../config/review.config.js";
import { BatchResultSchema, SummarySchema } from "./schema.js";
import {
  REVIEWER_SYSTEM_PROMPT,
  buildBatchPrompt,
  buildSummaryPrompt,
} from "./prompts.js";
import { computeScores } from "./scorer.js";
import logger from "../../utils/logger.js";

let _batchLLM = null;
let _summaryLLM = null;

function getBatchLLM() {
  if (_batchLLM) return _batchLLM;
  const model =
    process.env.STRUCTURED_OUTPUT_MODEL ||
    process.env.OPENROUTER_MODEL ||
    "openai/gpt-4o-mini";
  _batchLLM = createLLM({ model, temperature: 0.2, streaming: false })
    .withStructuredOutput(BatchResultSchema, { name: "report_issues" });
  logger.info(`[ProjectReviewer] Batch LLM ready (model: ${model})`);
  return _batchLLM;
}

function getSummaryLLM() {
  if (_summaryLLM) return _summaryLLM;
  const model =
    process.env.STRUCTURED_OUTPUT_MODEL ||
    process.env.OPENROUTER_MODEL ||
    "openai/gpt-4o-mini";
  _summaryLLM = createLLM({ model, temperature: 0.4, streaming: false })
    .withStructuredOutput(SummarySchema, { name: "summarise_review" });
  return _summaryLLM;
}

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// projectMeta: { project_name, description, requirements, skills_practiced }
// files: [{ path, content, lineCount, bytes }]
// onProgress: optional (pct, message) => Promise<void>
export async function runReviewerAgent({ projectMeta, files, onProgress }) {
  if (!files.length) {
    return {
      issues: [],
      summary: "No reviewable source files were found in the submission.",
      scores: { requirements: 0, codeQuality: 100, bugs: 100, syntax: 100 },
      overallScore: 0,
    };
  }

  const batches = chunk(files, BATCH_SIZE);
  const allIssues = [];
  const timeoutMs = Number(process.env.STRUCTURED_OUTPUT_TIMEOUT_MS) || 600000;
  const batchLLM = getBatchLLM();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const prompt = buildBatchPrompt({ projectMeta, files: batch });
    logger.info(
      `[ProjectReviewer] Batch ${i + 1}/${batches.length} (${batch.length} files)`
    );
    try {
      const result = await withTimeout(
        batchLLM.invoke([
          new SystemMessage({ content: REVIEWER_SYSTEM_PROMPT }),
          new HumanMessage({ content: prompt }),
        ]),
        timeoutMs,
        `Batch ${i + 1} LLM call`
      );
      const issues = (result?.issues || []).map((iss) => ({
        ...iss,
        issueId: randomUUID(),
      }));
      allIssues.push(...issues);
    } catch (err) {
      // Don't blow up the whole review on one bad batch — log and move on.
      logger.error(
        `[ProjectReviewer] Batch ${i + 1} failed: ${err.message}`
      );
    }
    if (onProgress) {
      const pct = 30 + Math.round(((i + 1) / batches.length) * 50); // 30 → 80
      await onProgress(pct, `Analysed ${i + 1}/${batches.length} batch(es)`);
    }
  }

  const { scores, overallScore } = computeScores(allIssues);

  // Stage 2: short narrative summary.
  let summary = "";
  try {
    const summaryRes = await withTimeout(
      getSummaryLLM().invoke([
        new SystemMessage({ content: REVIEWER_SYSTEM_PROMPT }),
        new HumanMessage({
          content: buildSummaryPrompt({
            projectMeta,
            issues: allIssues,
            scores,
            overallScore,
          }),
        }),
      ]),
      Math.min(timeoutMs, 90000),
      "Summary LLM call"
    );
    summary = summaryRes?.summary || "";
  } catch (err) {
    logger.error(`[ProjectReviewer] Summary failed: ${err.message}`);
    summary = `Review complete. ${allIssues.length} issue(s) found across ${files.length} file(s).`;
  }

  return { issues: allIssues, summary, scores, overallScore };
}

export default { runReviewerAgent };
