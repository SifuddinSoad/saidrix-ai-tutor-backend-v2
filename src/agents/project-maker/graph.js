// ===========================================
// Project-Maker Agent Graph (LangGraph)
// Two-stage agent (mirrors course-maker):
//   1. ReAct loop for research (uses tools)
//   2. Structured output for the final project set
// Then persists one Project doc per generated project.
// ===========================================

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { randomUUID } from "crypto";
import { createLLM } from "../../utils/llm.js";
import { getProjectMakerTools } from "./tools.js";
import {
  PROJECT_MAKER_SYSTEM_PROMPT,
  buildResearchPrompt,
  buildFinalPrompt,
} from "./prompts.js";
import { projectMakerSchema } from "./schema.js";
import Project from "../../db/models/Project.js";
import logger from "../../utils/logger.js";

// ===========================================
// Agent Construction (lazy singletons)
// ===========================================

let researchAgent = null;
let structuredLLM = null;

function getResearchAgent() {
  if (!researchAgent) {
    const llm = createLLM({ temperature: 0.3 });
    const tools = getProjectMakerTools();

    researchAgent = createReactAgent({
      llm,
      tools,
      messageModifier: PROJECT_MAKER_SYSTEM_PROMPT,
    });

    logger.info(
      `[ProjectMaker] Research agent ready with ${tools.length} tools`,
    );
  }
  return researchAgent;
}

function getStructuredLLM() {
  if (!structuredLLM) {
    const model =
      process.env.STRUCTURED_OUTPUT_MODEL ||
      process.env.OPENROUTER_MODEL ||
      "openai/gpt-4o-mini";

    const llm = createLLM({ model, temperature: 0.2, streaming: false });
    structuredLLM = llm.withStructuredOutput(projectMakerSchema, {
      name: "generate_projects",
    });
    logger.info(`[ProjectMaker] Structured-output LLM ready (model: ${model})`);
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
// Helpers
// ===========================================

// Flatten a Course document into an indexed outline string the LLM can
// reference for unlock_criteria (all indices 0-based).
function buildOutline(course) {
  const lines = [];
  (course.chapters || []).forEach((ch, ci) => {
    lines.push(`[chapter ${ci}] ${ch.chapter_name}`);
    (ch.modules || []).forEach((mod, mi) => {
      lines.push(`  [module ${ci}.${mi}] ${mod.module_name}`);
      (mod.sub_modules || []).forEach((sm, si) => {
        lines.push(`    [sub_module ${ci}.${mi}.${si}] ${sm.sub_module_name}`);
        (sm.topics || []).forEach((t, ti) => {
          lines.push(`      [topic ${ci}.${mi}.${si}.${ti}] ${t.topic_name}`);
        });
      });
    });
  });
  return lines.join("\n");
}

function extractResearchContext(messages) {
  const lines = [];
  for (const msg of messages) {
    const type = msg._getType?.() || msg.constructor?.name?.toLowerCase();
    if (type === "ai" && msg.content) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      if (content.trim()) lines.push(`[Agent]: ${content}`);
    }
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

function buildSummary(courseTitle, projects) {
  const rows = projects
    .map((p, i) => {
      const name = (p.project_name || `Project ${i + 1}`).replace(/\|/g, "/");
      const unlock = (p.unlock?.description || "—").replace(/\|/g, "/");
      const eff = p.estimated_effort_hours
        ? `${p.estimated_effort_hours}h`
        : "—";
      return `| ${i + 1} | ${name} | ${eff} | ${unlock} |`;
    })
    .join("\n");

  return `✅ **${projects.length} project${
    projects.length === 1 ? "" : "s"
  }** ready for **${courseTitle}**.

| # | Project | Effort | Unlocks |
|---|---------|--------|---------|
${rows}`;
}

// ===========================================
// Main Invocation
// ===========================================

// Inputs: { courseId, course, sessionId, userId, userContext }
//   - course: a Course document (lean object) — required
//   - userContext: optional free text from a chat user asking for a project
// Returns: { projectIds, projects, summary }

export async function invokeProjectMaker(input) {
  const {
    courseId,
    course,
    sessionId = null,
    userId = null,
    userContext = "",
    source = "auto",
    // When false, skip the ReAct research loop and generate projects
    // straight from the course outline with a single structured-output
    // call. The auto-after-course trigger uses research:false so that a
    // broad multi-course proposal doesn't spawn many heavy concurrent
    // research agents and saturate OpenRouter.
    research = true,
  } = input;

  if (!course || !courseId) {
    throw new Error("invokeProjectMaker requires { courseId, course }");
  }

  const startTime = Date.now();
  const courseTitle = course.course_title || "Untitled Course";
  logger.info(
    `[ProjectMaker] Starting project generation for: "${courseTitle}"`,
  );

  try {
    const outline = buildOutline(course);

    // --- Stage 1: Research (ReAct loop) — optional ---
    let researchContext;
    if (research) {
      const userRequest = buildResearchPrompt({
        courseTitle,
        courseDescription: course.course_description,
        outline,
        userContext,
      });

      const agent = getResearchAgent();
      const researchResult = await agent.invoke({
        messages: [new HumanMessage({ content: userRequest })],
      });
      const researchMessages = researchResult.messages || [];
      logger.info(
        `[ProjectMaker] Research complete (${researchMessages.length} messages)`,
      );
      researchContext = extractResearchContext(researchMessages);
    } else {
      logger.info(
        `[ProjectMaker] Research skipped (light mode) — structured output only`,
      );
      researchContext =
        "(No external research performed — design the projects directly " +
        "from the course outline above using your own expertise.)";
    }

    // --- Stage 2: Structured output ---
    const finalPrompt = buildFinalPrompt({
      courseTitle,
      courseDescription: course.course_description,
      outline,
      userContext,
      researchContext,
    });

    const llm = getStructuredLLM();
    const timeoutMs =
      Number(process.env.STRUCTURED_OUTPUT_TIMEOUT_MS) || 600000;

    logger.info(
      `[ProjectMaker] Calling structured LLM (timeout: ${timeoutMs}ms)...`,
    );

    const data = await withTimeout(
      llm.invoke([
        new SystemMessage({ content: PROJECT_MAKER_SYSTEM_PROMPT }),
        new HumanMessage({ content: finalPrompt }),
      ]),
      timeoutMs,
      "Structured output LLM call",
    );

    const generated = data?.projects || [];
    logger.info(
      `[ProjectMaker] Structured output received (${generated.length} projects)`,
    );

    if (generated.length === 0) {
      throw new Error("Project generation produced no projects");
    }

    // --- Stage 3: Persist one Project doc per generated project ---
    const now = Date.now();
    const docs = generated.map((p) => {
      const days = Number(p.deadline_days) || 0;
      const deadline =
        days > 0 ? new Date(now + days * 24 * 60 * 60 * 1000) : null;
      return {
        projectId: randomUUID(),
        courseId,
        source,
        project_name: p.project_name,
        description: p.description || "",
        requirements: p.requirements || [],
        skills_practiced: p.skills_practiced || [],
        unlock: {
          chapter_index: p.unlock_criteria?.chapter_index ?? 0,
          module_index: p.unlock_criteria?.module_index ?? 0,
          sub_module_index: p.unlock_criteria?.sub_module_index ?? 0,
          topic_indices: p.unlock_criteria?.topic_indices || [],
          description: p.unlock_criteria?.description || "",
        },
        estimated_effort_hours: Number(p.estimated_effort_hours) || 0,
        deadline,
        status: "locked",
        sessionId,
        userId,
        metadata: { deadline_days: days },
      };
    });

    const created = await Project.insertMany(docs);
    const projectIds = created.map((d) => d.projectId);
    const elapsed = Date.now() - startTime;

    logger.info(
      `[ProjectMaker] Saved ${projectIds.length} projects for course ${courseId} (${elapsed}ms)`,
    );

    const projects = created.map((d) => d.toObject());
    return {
      projectIds,
      projects,
      summary: buildSummary(courseTitle, projects),
    };
  } catch (err) {
    logger.error("[ProjectMaker] Generation failed:", err.message);
    throw new Error(`Project generation failed: ${err.message}`);
  }
}

export default { invokeProjectMaker };
