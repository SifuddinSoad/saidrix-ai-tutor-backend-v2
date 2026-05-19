// ===========================================
// Routine Output Schema
// Zod schema for a structured day-by-day study plan.
// `day_offset` is relative to the routine's startDate (0 == start
// date); the route converts offsets to absolute calendar dates.
// Used with llm.withStructuredOutput()
// ===========================================

import { z } from "zod";

const locationSchema = z.object({
  chapter_index: z.number().int().min(0),
  module_index: z.number().int().min(0),
  sub_module_index: z.number().int().min(0),
  topic_index: z.number().int().min(0),
});

const itemSchema = z.object({
  type: z
    .enum(["lecture", "project_deadline"])
    .describe(
      "'lecture' = study one course topic that day. 'project_deadline' = a " +
        "project is due that day."
    ),
  title: z
    .string()
    .describe(
      "For a lecture: the topic_name. For a project_deadline: the project name + ' (due)'."
    ),
  courseId: z.string().describe("The courseId this item belongs to"),
  location: locationSchema
    .optional()
    .describe("REQUIRED for 'lecture' items — the 0-based course location of the topic. Omit for project_deadline."),
  projectId: z
    .string()
    .optional()
    .describe("REQUIRED for 'project_deadline' items — the projectId that is due. Omit for lecture."),
  estimated_minutes: z
    .number()
    .describe("Estimated study minutes for this item (0 for a pure deadline marker)."),
});

const daySchema = z.object({
  day_offset: z
    .number()
    .int()
    .min(0)
    .describe("Days from startDate. 0 = the start date, 1 = next day, etc. Skip rest days by leaving gaps."),
  items: z.array(itemSchema).describe("What the learner does on this day."),
});

export const routineManagerSchema = z.object({
  routine_title: z
    .string()
    .describe("Short title for this study plan (e.g. 'React in 3 Weeks — 1h/day')"),
  days: z
    .array(daySchema)
    .min(1)
    .describe(
      "The schedule, in ascending day_offset order. Cover every course topic " +
        "in course order, respecting the daily time budget, and place each " +
        "project_deadline on the day after its prerequisite topics are scheduled."
    ),
});

export default routineManagerSchema;
