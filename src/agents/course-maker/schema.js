// ===========================================
// Course Output Schema
// Zod schema for structured course generation
// Hierarchy: Course > Chapters > Modules > Sub-modules > Topics
// Used with llm.withStructuredOutput()
// ===========================================

import { z } from "zod";

// --- Topic Schema (Leaf Level) ---
// One topic == one lecture. `description` is the lecture's coverage spec:
// a point-form checklist of EVERY sub-topic the lecture must cover, plus a
// short teaching-guidance line. (NOT the lecture content itself.)

const topicSchema = z.object({
  topic_name: z
    .string()
    .describe("Clear, focused topic title (e.g., 'Definition and History of ML')"),
  description: z
    .string()
    .describe(
      "Coverage checklist for the lecture on this topic. FIRST: a point-form list " +
        "(use '- ' bullets, one per line) of EVERY sub-topic this single lecture must " +
        "cover — be comprehensive and specific so nothing important is missed. " +
        "THEN: 1–2 lines of teaching guidance (how to sequence it, what examples/analogies " +
        "or demos to use, what to emphasize). This is the brief for a later LLM that " +
        "produces the actual lecture — it is NOT the lecture content itself."
    ),
});

// --- Sub-module Schema ---

const subModuleSchema = z.object({
  sub_module_name: z
    .string()
    .describe("Sub-module title (e.g., 'Sub-module 1.1.1: What is Machine Learning?')"),
  topics: z
    .array(topicSchema)
    .describe("Topics within this sub-module (typically 2–6)"),
});

// --- Module Schema ---

const moduleSchema = z.object({
  module_name: z
    .string()
    .describe("Module title (e.g., 'Module 1.1: Introduction to ML Concepts')"),
  sub_modules: z
    .array(subModuleSchema)
    .describe("Sub-modules within this module (typically 1–4)"),
});

// --- Chapter Schema ---

const chapterSchema = z.object({
  chapter_name: z
    .string()
    .describe("Chapter title (e.g., 'Chapter 1: Foundations of Machine Learning')"),
  modules: z
    .array(moduleSchema)
    .describe("Modules within this chapter (typically 2–5)"),
});

// ===========================================
// Main Course Schema (Root)
// ===========================================

export const courseSchema = z.object({
  course_title: z.string().describe("Engaging, descriptive course title"),
  course_description: z
    .string()
    .describe("Brief course overview — what learners will gain"),
  chapters: z
    .array(chapterSchema)
    .describe("Course chapters in logical progression (typically 3–8)"),
});

export default courseSchema;
