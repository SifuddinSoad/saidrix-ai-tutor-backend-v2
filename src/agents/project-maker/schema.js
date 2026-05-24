// ===========================================
// Project Output Schema
// Zod schema for structured project generation.
// The agent decides how many projects a course needs (1..several).
// Used with llm.withStructuredOutput()
// ===========================================

import { z } from "zod";

// --- Unlock criteria ---
// Points at the LATEST course location whose knowledge the project
// depends on. Stored as descriptive metadata (enforcement is a later,
// separate piece of work).

const unlockCriteriaSchema = z.object({
  chapter_index: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based index of the LAST chapter whose knowledge this project needs"
    ),
  module_index: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based index of the last module (within that chapter) the project needs"
    ),
  sub_module_index: z
    .number()
    .int()
    .min(0)
    .describe(
      "0-based index of the last sub_module (within that module) the project " +
        "needs. The project unlocks once every topic up to and including this " +
        "sub_module is completed."
    ),
  topic_indices: z
    .array(z.number().int().min(0))
    .describe(
      "0-based indices of the specific topics whose knowledge is required " +
        "before this project can reasonably be attempted"
    ),
  description: z
    .string()
    .describe(
      "One sentence, learner-facing: what must be learned/completed before " +
        "this project unlocks (e.g. 'Unlocks after you finish the DOM & Events topics in Chapter 2')."
    ),
});

// --- Single Project ---

const projectSchema = z.object({
  project_name: z
    .string()
    .describe("Short, motivating project title (e.g. 'Build a Todo App with Local Storage')"),
  description: z
    .string()
    .describe(
      "2–4 sentences: what the learner will build, why it reinforces the " +
        "course material, and the expected end result."
    ),
  requirements: z
    .array(z.string())
    .describe(
      "Concrete, checkable requirements / acceptance criteria the finished " +
        "project must satisfy (point-form, specific — typically 3–8 items)."
    ),
  skills_practiced: z
    .array(z.string())
    .describe("The course skills/concepts this project exercises."),
  unlock_criteria: unlockCriteriaSchema,
  estimated_effort_hours: z
    .number()
    .describe("Realistic total hours a learner needs to complete this project."),
  deadline_days: z
    .number()
    .int()
    .min(1)
    .describe(
      "Recommended number of days AFTER unlock to finish the project, sized " +
        "to estimated_effort_hours (e.g. a 6h project ≈ 5–7 days)."
    ),
});

// ===========================================
// Root Schema — a set of projects for one course
// ===========================================

export const projectMakerSchema = z.object({
  projects: z
    .array(projectSchema)
    .min(1)
    .describe(
      "Practical projects for this course, ordered by the course progression " +
        "they unlock at. Choose a sensible count based on the course's size " +
        "and scope (a short course may need only 1; a broad one several)."
    ),
});

export default projectMakerSchema;
