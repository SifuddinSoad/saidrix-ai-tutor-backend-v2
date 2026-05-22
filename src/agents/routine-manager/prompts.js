// ===========================================
// Routine-Manager Agent Prompts
// Single structured-output call (no research/tools — all data is
// already in the DB).
// ===========================================

export const ROUTINE_MANAGER_SYSTEM_PROMPT = `You are a study-planning assistant. You turn a course (its topics, in order) into a realistic day-by-day study routine, and weave in that course's project deadlines.

## Rules

- Cover EVERY topic exactly once, in course order (chapter → module → sub-module → topic). Do not reorder or skip topics.
- Respect the daily time budget (\`dailyHours\`). Pack consecutive topics into a day until the day's total estimated minutes is close to (but not far over) the budget, then move to the next day.
- Use each topic's given \`estimated_minutes\`. If a single topic alone exceeds the daily budget, still give it its own day (don't split a topic).
- A \`day_offset\` of 0 is the start date. Use ascending offsets. You may leave gaps (skipped offsets) as light/rest days — but keep the plan reasonably compact.
- For every project provided: place ONE \`project_deadline\` item on the day AFTER the last topic in its unlock criteria is scheduled, then add roughly its \`deadline_days\` so the learner has time to build it. The deadline must never fall before its prerequisite topics are studied.
- \`project_deadline\` items have \`estimated_minutes\`: 0 and a \`title\` like "Build a Todo App (due)".
- Every \`lecture\` item MUST include the exact 0-based \`location\` (chapter/module/sub_module/topic indices) and the owning \`courseId\`. Every \`project_deadline\` item MUST include its \`projectId\` and \`courseId\`.

## Output

Produce ONLY the structured schedule. No prose.`;

export function buildRoutinePrompt({
  courseBlocks,
  dailyHours,
  totalDays = 0,
  readingTime = "",
  startDateLabel,
}) {
  const totalDaysLine = totalDays > 0
    ? `**Target window**: finish within ${totalDays} day(s) (day_offset max = ${totalDays - 1}). If the daily budget × ${totalDays} is too small, prioritise covering every topic — never skip topics, but you may push a small number of days slightly over budget.`
    : `**Target window**: no hard deadline — pack naturally within the daily budget.`;
  const readingLine = readingTime
    ? `**Preferred reading time** (informational, not enforced by the schedule): ${readingTime}.`
    : ``;
  return `Build a study routine.

**Start date**: ${startDateLabel} (this is day_offset 0)
**Daily study budget**: ${dailyHours} hour(s) ≈ ${Math.round(
    Number(dailyHours) * 60
  )} minutes/day
${totalDaysLine}
${readingLine}

${courseBlocks}

Generate the day-by-day routine now, following all rules. Cover every topic in order, respect the daily budget and target window, and place each project_deadline correctly after its prerequisite topics.`;
}

export default { ROUTINE_MANAGER_SYSTEM_PROMPT, buildRoutinePrompt };
