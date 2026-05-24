// ===========================================
// Lecture-Maker Agent Graph (LangGraph)
// Two-stage agent:
//   1. ReAct loop for research (uses tools)
//   2. Structured output to generate the lecture blocks
// Saves to Lecture collection
// ===========================================

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { randomUUID } from "crypto";
import { createLLM } from "../../utils/llm.js";
import { getLectureMakerTools } from "./tools.js";
import {
  LECTURE_MAKER_SYSTEM_PROMPT,
  buildResearchPrompt,
  buildFinalPrompt,
} from "./prompts.js";
import { lectureSchema } from "./schema.js";
import Lecture from "../../db/models/Lecture.js";
import logger from "../../utils/logger.js";

// ===========================================
// Agent Construction (Lazy Singletons)
// ===========================================

let researchAgent = null;
let structuredLLM = null;
let structuredBaseLLM = null; // same model WITHOUT structured wrapper (for diagnostics)

function getResearchAgent() {
  if (!researchAgent) {
    // The ReAct loop REQUIRES a model that supports tool/function calling.
    // Many "...:free" models (e.g. google/gemma-*:free) do NOT — they
    // stall or error on tool calls. Default research to the structured
    // model (tool-capable) unless RESEARCH_MODEL is explicitly set.
    const model =
      process.env.RESEARCH_MODEL ||
      process.env.STRUCTURED_OUTPUT_MODEL ||
      process.env.OPENROUTER_MODEL ||
      "openai/gpt-4o-mini";

    // streaming:false → research output is consumed whole, and a
    // non-terminating stream can't leave the call open indefinitely.
    const llm = createLLM({ model, temperature: 0.4, streaming: false });
    const tools = getLectureMakerTools();

    researchAgent = createReactAgent({
      llm,
      tools,
      messageModifier: LECTURE_MAKER_SYSTEM_PROMPT,
    });

    logger.info(
      `[LectureMaker] Research agent ready (model: ${model}, ${tools.length} tools)`
    );
  }
  return researchAgent;
}

function getStructuredLLM() {
  if (!structuredLLM) {
    // Use a separate (reliable) model for structured output.
    // Function calling / structured output requires a model that
    // supports it well — many free models hang silently otherwise.
    const model =
      process.env.STRUCTURED_OUTPUT_MODEL ||
      process.env.OPENROUTER_MODEL ||
      "openai/gpt-4o-mini";

    const llm = createLLM({
      model,
      temperature: 0.3,
      streaming: false,
      // Lecture JSON is large; give it room so the model can't return a
      // truncated/empty tool-call payload that fails to parse.
      maxTokens: Number(process.env.STRUCTURED_OUTPUT_MAX_TOKENS) || 8000,
    });

    structuredBaseLLM = llm;
    // includeRaw → on failure we can inspect what the model actually
    // returned (empty content? no tool_calls? length finish?) instead of
    // a cryptic "Unexpected end of JSON input".
    structuredLLM = llm.withStructuredOutput(lectureSchema, {
      name: "generate_lecture",
      includeRaw: true,
    });

    logger.info(`[LectureMaker] Structured-output LLM ready (model: ${model})`);
  }
  return structuredLLM;
}

// --- Robust structured invocation ---
// withStructuredOutput throws "Unexpected end of JSON input" when the
// model returns an empty / blank tool-call payload. Retry, and on
// persistent failure log what the model actually produced + throw a
// message that names the real cause.
async function invokeStructured(messages, timeoutMs) {
  const llm = getStructuredLLM();
  const maxAttempts = 2;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await withTimeout(
        llm.invoke(messages),
        timeoutMs,
        "Structured output LLM call"
      );
      // includeRaw shape: { raw, parsed }
      const parsed = res?.parsed ?? res;
      if (!parsed || !parsed.blocks || parsed.blocks.length === 0) {
        throw new Error("Model returned an empty/blocks-less lecture object");
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      logger.warn(
        `[LectureMaker] Structured attempt ${attempt}/${maxAttempts} failed: ${err.message}`
      );

      // Diagnose: call the SAME model without the structured wrapper so
      // we can see the raw output and explain WHY it didn't parse.
      try {
        const raw = await withTimeout(
          structuredBaseLLM.invoke(messages),
          Math.min(timeoutMs, 60000),
          "Structured diagnostic call"
        );
        const content =
          typeof raw?.content === "string"
            ? raw.content
            : JSON.stringify(raw?.content ?? "");
        logger.error(
          `[LectureMaker] Raw model output — len=${content.length}, ` +
            `tool_calls=${raw?.tool_calls?.length || 0}, ` +
            `finish=${raw?.response_metadata?.finish_reason || raw?.response_metadata?.finishReason || "?"}`
        );
        if (content) {
          logger.error(
            `[LectureMaker] Raw content (first 500): ${content.slice(0, 500)}`
          );
        }
      } catch (diagErr) {
        logger.error(
          `[LectureMaker] Diagnostic call also failed: ${diagErr.message}`
        );
      }
    }
  }

  throw new Error(
    `Structured output failed after ${maxAttempts} attempts: ${lastErr?.message}. ` +
      `The model (${process.env.STRUCTURED_OUTPUT_MODEL || process.env.OPENROUTER_MODEL}) ` +
      `returned no parseable JSON — it likely doesn't support function-calling ` +
      `structured output, hit a content filter, or the prompt was too large. ` +
      `Try a known-good STRUCTURED_OUTPUT_MODEL (e.g. openai/gpt-4o-mini).`
  );
}

// --- Wrap a promise with a hard timeout ---
// Throws if the promise doesn't resolve within `ms` milliseconds.
// Critical: prevents silent hangs from stalling jobs forever.

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

// ===========================================
// Main Invocation
// ===========================================

// --- Invoke Lecture-Maker ---
// Inputs: { course, location, topic, userId, onProgress? }
//   - course: full course doc (for context: title, chapter/module/sub_module names)
//   - location: { chapter_index, module_index, sub_module_index, topic_index }
//   - topic: { topic_name, description }
//   - onProgress: optional callback(percent, message) to report progress
// Returns: { lectureId, lecture }

export async function invokeLectureMaker(input) {
  const {
    course,
    location,
    topic,
    userId = "default",
    onProgress = () => {},
  } = input;

  const startTime = Date.now();
  logger.info(
    `[LectureMaker] Generating lecture for topic: "${topic.topic_name}"`
  );

  try {
    // --- Stage 1: Research with tools (ReAct loop) ---
    onProgress(10, "Researching topic...");

    const researchPrompt = buildResearchPrompt({ course, location, topic });
    const agent = getResearchAgent();

    const researchTimeoutMs =
      Number(process.env.RESEARCH_TIMEOUT_MS) || 180000; // 3min default

    logger.info(
      `[LectureMaker] Running research ReAct loop (timeout: ${researchTimeoutMs}ms)...`
    );

    // Stage 1 had NO timeout before — a stalled LLM/tool call hung the
    // job forever with no further logs. Bound it, and cap the ReAct
    // recursion so a tool-call loop can't spin indefinitely.
    const researchResult = await withTimeout(
      agent.invoke(
        { messages: [new HumanMessage({ content: researchPrompt })] },
        { recursionLimit: 12 }
      ),
      researchTimeoutMs,
      "Research ReAct loop"
    );

    const researchMessages = researchResult.messages || [];
    logger.info(
      `[LectureMaker] Research complete (${researchMessages.length} messages)`
    );

    onProgress(50, "Composing lecture content...");

    // --- Stage 2: Structured output ---
    const finalPrompt = buildFinalPrompt({
      course,
      location,
      topic,
      researchContext: extractResearchContext(researchMessages),
      language: course.language || "English",
    });

    const timeoutMs =
      Number(process.env.STRUCTURED_OUTPUT_TIMEOUT_MS) || 600000; // 10min default

    logger.info(
      `[LectureMaker] Calling structured LLM (timeout: ${timeoutMs}ms)...`
    );

    // Robust call: retries + diagnostics on empty/unparseable output.
    const lectureData = await invokeStructured(
      [
        new SystemMessage({ content: LECTURE_MAKER_SYSTEM_PROMPT }),
        new HumanMessage({ content: finalPrompt }),
      ],
      timeoutMs
    );

    logger.info(
      `[LectureMaker] Structured output received (${lectureData.blocks?.length || 0} blocks)`
    );

    onProgress(85, "Saving lecture...");

    // --- Stage 3: Save to MongoDB ---
    const lectureId = randomUUID();
    const elapsed = Date.now() - startTime;

    // Upsert: replace existing lecture for this topic if regenerating
    const lectureDoc = await Lecture.findOneAndUpdate(
      {
        courseId: course.courseId,
        "location.chapter_index": location.chapter_index,
        "location.module_index": location.module_index,
        "location.sub_module_index": location.sub_module_index,
        "location.topic_index": location.topic_index,
      },
      {
        lectureId,
        courseId: course.courseId,
        location,
        topic_name: topic.topic_name,
        topic_description: topic.description,
        title: lectureData.title,
        summary: lectureData.summary,
        estimated_duration_minutes: lectureData.estimated_duration_minutes,
        language: course.language || "English",
        blocks: lectureData.blocks,
        sources: lectureData.sources,
        userId,
        metadata: {
          generatedIn: `${elapsed}ms`,
          blockCount: lectureData.blocks.length,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    onProgress(100, "Lecture ready");

    logger.info(
      `[LectureMaker] Lecture saved: ${lectureDoc.lectureId} (${elapsed}ms, ${lectureData.blocks.length} blocks)`
    );

    return {
      lectureId: lectureDoc.lectureId,
      lecture: lectureDoc.toObject(),
    };
  } catch (err) {
    logger.error("[LectureMaker] Generation failed:", err.message);
    throw new Error(`Lecture generation failed: ${err.message}`);
  }
}

// ===========================================
// Prompt Builders
// ===========================================

// (Stage prompt builders moved to ./prompts.js — edit them there.)

// --- Extract Tool Results & AI Messages from Research ---

function extractResearchContext(messages) {
  const lines = [];

  for (const msg of messages) {
    const type = msg._getType?.() || msg.constructor?.name?.toLowerCase();

    if (type === "ai" && msg.content) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      if (content.trim()) {
        lines.push(`[Agent]: ${content}`);
      }
    }

    if (type === "tool" && msg.content) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      lines.push(
        `[Tool: ${msg.name || "unknown"}]: ${content.slice(0, 3000)}`
      );
    }
  }

  // Clamp total size — an over-long prompt can push the model to
  // truncate or return an empty completion (the JSON-parse failure).
  const MAX = Number(process.env.RESEARCH_CONTEXT_MAX_CHARS) || 16000;
  const joined = lines.join("\n\n");
  if (joined.length > MAX) {
    logger.warn(
      `[LectureMaker] Research context ${joined.length} chars > ${MAX}, truncating`
    );
    return joined.slice(0, MAX);
  }
  return joined;
}

export default { invokeLectureMaker };
