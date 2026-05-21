// ===========================================
// Zod schemas for the Project Reviewer agent
// ===========================================

import { z } from "zod";

export const IssueSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  category: z.enum(["requirements", "codeQuality", "bugs", "syntax"]),
  filePath: z.string().describe("Path relative to the project root, exactly as given"),
  lineStart: z.number().int().min(1),
  lineEnd: z.number().int().min(1),
  title: z.string().describe("Short headline, < 80 chars"),
  description: z.string().describe("Explanation of the problem"),
  suggestion: z.string().describe("Concrete fix"),
  codeSnippet: z.string().describe("The offending lines, exactly as in the file"),
});

export const BatchResultSchema = z.object({
  issues: z.array(IssueSchema),
});

export const SummarySchema = z.object({
  summary: z
    .string()
    .describe(
      "2-3 sentence overall verdict on the project: what works, what doesn't, " +
        "and what the student should focus on first."
    ),
});

export default { IssueSchema, BatchResultSchema, SummarySchema };
