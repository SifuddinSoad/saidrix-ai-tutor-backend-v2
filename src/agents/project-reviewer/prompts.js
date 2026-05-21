// ===========================================
// Prompts for the Project Reviewer agent
// ===========================================

export const REVIEWER_SYSTEM_PROMPT = `You are a senior software engineer reviewing a student's project submission.

Your job is to find concrete, line-numbered issues across FOUR categories:
- requirements: the code fails (or is missing) something the project requirements asked for
- codeQuality: anti-patterns, naming, complexity, dead code, missing error handling
- bugs: real defects that would cause incorrect behaviour at runtime
- syntax: parse errors, broken imports, unmatched braces, obvious typos

Severity rubric:
- critical: breaks the project / data loss / security flaw / missing core requirement
- warning: incorrect or risky but not catastrophic
- info: style, suggestion, minor improvement

Rules:
1. EVERY issue must include the EXACT filePath as given AND accurate lineStart/lineEnd. Lines are 1-indexed.
2. Quote the offending code in codeSnippet exactly as it appears.
3. Be specific. "Could be better" is useless — say WHY and HOW.
4. Do NOT invent files, functions, or imports that aren't in the source.
5. If the project has no issues in a file, return zero issues for that file. Do not pad.
6. Output only via the structured schema. No prose outside the schema.`;

export function buildBatchPrompt({ projectMeta, files }) {
  const fileBlocks = files
    .map((f) => {
      const numbered = f.content
        .split(/\r?\n/)
        .map((line, i) => `${String(i + 1).padStart(4, " ")} | ${line}`)
        .join("\n");
      return `FILE: ${f.path}\n${"-".repeat(60)}\n${numbered}\n`;
    })
    .join("\n");

  return `# Project being reviewed
Name: ${projectMeta.project_name || "(untitled)"}
Description: ${projectMeta.description || "(none)"}

Requirements the student was asked to satisfy:
${(projectMeta.requirements || []).map((r, i) => `  ${i + 1}. ${r}`).join("\n") || "  (none provided)"}

Skills the project should practice:
${(projectMeta.skills_practiced || []).join(", ") || "(none)"}

# Files in this batch
The line numbers in the prefix ("  12 | ...") are the file's real line numbers.
Use them verbatim in lineStart / lineEnd.

${fileBlocks}

# Task
Find every issue you can across the four categories above. Return them via the structured output.`;
}

export function buildSummaryPrompt({ projectMeta, issues, scores, overallScore }) {
  const counts = issues.reduce(
    (acc, i) => ((acc[i.severity] = (acc[i.severity] || 0) + 1), acc),
    {}
  );
  return `Project: ${projectMeta.project_name}
Issues found: ${issues.length} (critical ${counts.critical || 0}, warning ${counts.warning || 0}, info ${counts.info || 0})
Scores: overall ${overallScore}, requirements ${scores.requirements}, codeQuality ${scores.codeQuality}, bugs ${scores.bugs}, syntax ${scores.syntax}

Write a 2-3 sentence student-facing summary: what's working, the biggest thing to fix first, and an encouraging closing note. Plain text, no markdown.`;
}

export default {
  REVIEWER_SYSTEM_PROMPT,
  buildBatchPrompt,
  buildSummaryPrompt,
};
