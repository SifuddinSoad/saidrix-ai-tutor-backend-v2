// ===========================================
// Course-Maker Agent Graph (LangGraph)
// Two-stage agent:
//   1. ReAct loop for research (uses tools)
//   2. Structured output for final course JSON
// ===========================================

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { randomUUID } from "crypto";
import { createLLM } from "../../utils/llm.js";
import { getCourseMakerTools } from "./tools.js";
import {
  COURSE_MAKER_SYSTEM_PROMPT,
  buildResearchPrompt,
  buildFinalPrompt,
} from "./prompts.js";
import { courseSchema } from "./schema.js";
import Course from "../../db/models/Course.js";
import Job from "../../db/models/Job.js";
import logger from "../../utils/logger.js";

// ===========================================
// Agent Construction
// ===========================================

// --- Lazy singleton — created on first use ---
let researchAgent = null;
let structuredLLM = null;

function getResearchAgent() {
  if (!researchAgent) {
    const llm = createLLM({ temperature: 0.3 });
    const tools = getCourseMakerTools();

    researchAgent = createReactAgent({
      llm,
      tools,
      messageModifier: COURSE_MAKER_SYSTEM_PROMPT,
    });

    logger.info(
      `[CourseMaker] Research agent ready with ${tools.length} tools`,
    );
  }
  return researchAgent;
}

function getStructuredLLM() {
  if (!structuredLLM) {
    // Use a reliable model for structured output (free models often hang)
    const model =
      process.env.STRUCTURED_OUTPUT_MODEL ||
      process.env.OPENROUTER_MODEL ||
      "openai/gpt-4o-mini";

    const llm = createLLM({ model, temperature: 0.2, streaming: false });
    structuredLLM = llm.withStructuredOutput(courseSchema, {
      name: "generate_course",
    });
    logger.info(`[CourseMaker] Structured-output LLM ready (model: ${model})`);
  }
  return structuredLLM;
}

// --- Hard timeout wrapper (prevents silent hangs) ---

function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

// ===========================================
// Main Invocation
// ===========================================

// --- Invoke Course-Maker ---
// Inputs: { topic, level, goals, duration, preferences, sessionId, userId }
// Returns: { courseId, course, summary }

export async function invokeCourseMaker(input) {
  const {
    topic,
    level = "beginner",
    goals = "",
    duration = "",
    preferences = "",
    sessionId = null,
    userId = null,
  } = input;

  const startTime = Date.now();
  logger.info(`[CourseMaker] Starting course generation for: "${topic}"`);

  try {
    // --- Stage 1: Research with tools (ReAct loop) ---
    const userRequest = buildResearchPrompt({
      topic,
      level,
      goals,
      duration,
      preferences,
    });

    const agent = getResearchAgent();
    const researchResult = await agent.invoke({
      messages: [new HumanMessage({ content: userRequest })],
    });

    // Collect all messages from the research stage
    const researchMessages = researchResult.messages || [];
    logger.info(
      `[CourseMaker] Research complete (${researchMessages.length} messages)`,
    );

    // --- Stage 2: Structured output ---
    // Pass research context to a structured-output LLM
    const finalPrompt = buildFinalPrompt({
      topic,
      level,
      goals,
      duration,
      preferences,
      researchContext: extractResearchContext(researchMessages),
    });

    const llm = getStructuredLLM();
    const timeoutMs =
      Number(process.env.STRUCTURED_OUTPUT_TIMEOUT_MS) || 600000; // 10min default

    logger.info(
      `[CourseMaker] Calling structured LLM (timeout: ${timeoutMs}ms)...`,
    );

    const courseData = await withTimeout(
      llm.invoke([
        new SystemMessage({ content: COURSE_MAKER_SYSTEM_PROMPT }),
        new HumanMessage({ content: finalPrompt }),
      ]),
      timeoutMs,
      "Structured output LLM call",
    );

    logger.info(
      `[CourseMaker] Structured output received (${courseData.chapters?.length || 0} chapters)`,
    );

    // --- Stage 3: Save to MongoDB ---
    const courseId = randomUUID();
    const elapsed = Date.now() - startTime;

    const courseDoc = await Course.create({
      courseId,
      course_title: courseData.course_title,
      course_description: courseData.course_description,
      chapters: courseData.chapters,
      sessionId,
      userId,
    });

    logger.info(
      `[CourseMaker] Course saved: ${courseId} (${elapsed}ms, ${courseData.chapters.length} chapters)`,
    );

    // --- Auto-generate practice projects for this course ---
    // Fire-and-forget background Job (same precedent as the post-lecture
    // enrichment chain): the course response must NOT wait on project
    // generation. The client polls GET /api/projects/job/:jobId or
    // GET /api/projects?courseId=... once it has the courseId.
    const projJobId = randomUUID();
    const projParams = {
      courseId,
      userId,
      sessionId,
      source: "auto",
      research: false, // light mode — no ReAct loop (avoids OpenRouter contention)
    };
    Job.create({
      jobId: projJobId,
      type: "project",
      status: "pending",
      input: projParams,
      userId,
    })
      .then(() => import("../project-maker/job.js"))
      .then((m) => m.processProjectJob(projJobId, projParams))
      .catch((err) =>
        logger.error(
          `[CourseMaker] auto-project generation failed: ${err.message}`,
        ),
      );

    // --- Build a short summary for the chat agent ---
    const summary = buildSummary(courseData);

    return {
      courseId,
      course: courseDoc.toObject(),
      summary,
    };
  } catch (err) {
    logger.error("[CourseMaker] Generation failed:", err.message);
    throw new Error(`Course generation failed: ${err.message}`);
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

    // AI messages (the agent's reasoning + summary)
    if (type === "ai" && msg.content) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      if (content.trim()) {
        lines.push(`[Agent]: ${content}`);
      }
    }

    // Tool results
    if (type === "tool" && msg.content) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      lines.push(`[Tool: ${msg.name || "unknown"}]: ${content.slice(0, 2000)}`);
    }
  }

  return lines.join("\n\n");
}

// --- Build Summary for Chat Agent ---
// Produces a readable markdown overview of the generated course

// Compact, chat-safe overview: a short line + a chapter table with a
// one-line "covers" derived from each chapter's module names.
// NOTE: never include courseId or internal API hints here — the
// courseId travels separately in the hidden ```course block.
function buildSummary(course) {
  const rows = course.chapters
    .map((ch, i) => {
      const modNames = (ch.modules || [])
        .map((m) => (m.module_name || "").replace(/^Module[^:]*:\s*/i, ""))
        .filter(Boolean);
      let covers = modNames.slice(0, 3).join("; ");
      if (modNames.length > 3) covers += "; …";
      const cleanCh = (ch.chapter_name || `Chapter ${i + 1}`).replace(
        /\|/g,
        "/",
      );
      covers = (covers || "—").replace(/\|/g, "/");
      return `| ${i + 1} | ${cleanCh} | ${covers} |`;
    })
    .join("\n");

  return `✅ **${course.course_title}** — course is ready.

| # | Chapter | Covers |
|---|---------|--------|
${rows}`;
}

export default { invokeCourseMaker };
