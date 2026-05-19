// ===========================================
// Routine-Manager Agent Graph
// Single-stage: one structured-output LLM call. No ReAct/tools — all
// inputs (course structure, lecture durations, projects) are already
// in the DB. Produces a day-by-day study plan and persists a Routine.
// ===========================================

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { randomUUID } from "crypto";
import { createLLM } from "../../utils/llm.js";
import {
  ROUTINE_MANAGER_SYSTEM_PROMPT,
  buildRoutinePrompt,
} from "./prompts.js";
import { routineManagerSchema } from "./schema.js";
import Course from "../../db/models/Course.js";
import Lecture from "../../db/models/Lecture.js";
import Project from "../../db/models/Project.js";
import Routine from "../../db/models/Routine.js";
import logger from "../../utils/logger.js";

const DEFAULT_TOPIC_MINUTES = 30; // used when no Lecture exists yet

let structuredLLM = null;

function getStructuredLLM() {
  if (!structuredLLM) {
    const model =
      process.env.STRUCTURED_OUTPUT_MODEL ||
      process.env.OPENROUTER_MODEL ||
      "openai/gpt-4o-mini";

    const llm = createLLM({ model, temperature: 0.2, streaming: false });
    structuredLLM = llm.withStructuredOutput(routineManagerSchema, {
      name: "generate_routine",
    });
    logger.info(`[RoutineManager] Structured-output LLM ready (model: ${model})`);
  }
  return structuredLLM;
}

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

// Build the per-course prompt block: an indexed topic list (with the
// best-available duration estimate) plus the course's projects.
function buildCourseBlock(course, lectureMap, projects) {
  const lines = [`### Course "${course.course_title}" (courseId: ${course.courseId})`];
  lines.push("Topics (study in this exact order):");

  (course.chapters || []).forEach((ch, ci) => {
    (ch.modules || []).forEach((mod, mi) => {
      (mod.sub_modules || []).forEach((sm, si) => {
        (sm.topics || []).forEach((t, ti) => {
          const key = `${ci}.${mi}.${si}.${ti}`;
          const mins = lectureMap.get(key) || DEFAULT_TOPIC_MINUTES;
          lines.push(
            `- location[${key}] "${t.topic_name}" — ~${mins} min ` +
              `(chapter "${ch.chapter_name}")`
          );
        });
      });
    });
  });

  if (projects.length > 0) {
    lines.push("");
    lines.push("Projects (place a project_deadline for each):");
    for (const p of projects) {
      const u = p.unlock || {};
      lines.push(
        `- projectId ${p.projectId} "${p.project_name}" — ` +
          `unlock at chapter ${u.chapter_index ?? 0}, module ${
            u.module_index ?? 0
          }, topics [${(u.topic_indices || []).join(", ")}]; ` +
          `effort ~${p.estimated_effort_hours || 0}h; ` +
          `~${p.metadata?.deadline_days || 7} days after unlock to finish`
      );
    }
  } else {
    lines.push("");
    lines.push("Projects: (none for this course)");
  }

  return lines.join("\n");
}

// Inputs: { userId, courseIds, dailyHours, startDate, sessionId }
// Returns: { routineId, routine, summary }
export async function invokeRoutineManager(input) {
  const {
    userId = "default",
    courseIds = [],
    dailyHours = 1,
    startDate = new Date(),
    sessionId = null,
  } = input;

  if (!Array.isArray(courseIds) || courseIds.length === 0) {
    throw new Error("invokeRoutineManager requires a non-empty courseIds array");
  }

  const start = startDate instanceof Date ? startDate : new Date(startDate);
  if (isNaN(start.getTime())) {
    throw new Error("invalid startDate");
  }

  const startTime = Date.now();
  logger.info(
    `[RoutineManager] Building routine for courses [${courseIds.join(", ")}]`
  );

  try {
    const courses = await Course.find({ courseId: { $in: courseIds } }).lean();
    if (courses.length === 0) {
      throw new Error("No matching courses found");
    }

    const blocks = [];
    for (const course of courses) {
      // Map existing lecture durations by course location
      const lectures = await Lecture.find({ courseId: course.courseId })
        .select("location estimated_duration_minutes")
        .lean();
      const lectureMap = new Map();
      for (const lec of lectures) {
        const l = lec.location || {};
        const key = `${l.chapter_index}.${l.module_index}.${l.sub_module_index}.${l.topic_index}`;
        if (lec.estimated_duration_minutes) {
          lectureMap.set(key, lec.estimated_duration_minutes);
        }
      }

      const projects = await Project.find({ courseId: course.courseId }).lean();
      blocks.push(buildCourseBlock(course, lectureMap, projects));
    }

    const startDateLabel = start.toISOString().slice(0, 10);
    const prompt = buildRoutinePrompt({
      courseBlocks: blocks.join("\n\n"),
      dailyHours,
      startDateLabel,
    });

    const llm = getStructuredLLM();
    const timeoutMs =
      Number(process.env.STRUCTURED_OUTPUT_TIMEOUT_MS) || 600000;

    const data = await withTimeout(
      llm.invoke([
        new SystemMessage({ content: ROUTINE_MANAGER_SYSTEM_PROMPT }),
        new HumanMessage({ content: prompt }),
      ]),
      timeoutMs,
      "Structured output LLM call"
    );

    const planDays = data?.days || [];
    if (planDays.length === 0) {
      throw new Error("Routine generation produced no days");
    }

    // Convert day_offset → absolute calendar date (midnight of that day)
    const startMidnight = new Date(start);
    startMidnight.setHours(0, 0, 0, 0);

    const days = planDays
      .slice()
      .sort((a, b) => (a.day_offset || 0) - (b.day_offset || 0))
      .map((d) => {
        const date = new Date(startMidnight);
        date.setDate(date.getDate() + (Number(d.day_offset) || 0));
        return {
          date,
          items: (d.items || []).map((it) => ({
            type: it.type,
            title: it.title,
            courseId: it.courseId || "",
            location: it.type === "lecture" ? it.location : undefined,
            projectId:
              it.type === "project_deadline" ? it.projectId : undefined,
            estimated_minutes: Number(it.estimated_minutes) || 0,
          })),
        };
      });

    const routineId = randomUUID();
    const routineDoc = await Routine.create({
      routineId,
      title: data.routine_title || "Study Routine",
      courseIds,
      startDate: start,
      dailyHours,
      days,
      sessionId,
      userId,
    });

    const elapsed = Date.now() - startTime;
    logger.info(
      `[RoutineManager] Routine saved: ${routineId} (${elapsed}ms, ${days.length} days)`
    );

    return {
      routineId,
      routine: routineDoc.toObject(),
      summary: buildSummary(data.routine_title || "Study Routine", days),
    };
  } catch (err) {
    logger.error("[RoutineManager] Generation failed:", err.message);
    throw new Error(`Routine generation failed: ${err.message}`);
  }
}

function buildSummary(title, days) {
  const totalItems = days.reduce((n, d) => n + d.items.length, 0);
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
  return `✅ **${title}** — ${days.length} study day(s), ${totalItems} item(s), ${fmt(
    first
  )} → ${fmt(last)}.`;
}

export default { invokeRoutineManager };
