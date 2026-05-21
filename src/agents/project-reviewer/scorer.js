// ===========================================
// Scorer — deterministic post-processing
// Issue weights deduct from a starting 100 per category, clamped to
// [0, 100]. Overall score = weighted average across categories.
// ===========================================

const SEVERITY_WEIGHT = { critical: 15, warning: 5, info: 1 };
const CATEGORIES = ["requirements", "codeQuality", "bugs", "syntax"];

export function computeScores(issues = []) {
  const deductions = { requirements: 0, codeQuality: 0, bugs: 0, syntax: 0 };
  for (const issue of issues) {
    const w = SEVERITY_WEIGHT[issue.severity] ?? 0;
    if (deductions[issue.category] != null) {
      deductions[issue.category] += w;
    }
  }
  const scores = {};
  for (const cat of CATEGORIES) {
    scores[cat] = Math.max(0, Math.min(100, 100 - deductions[cat]));
  }
  // Requirements + bugs weigh more in the overall grade.
  const overallScore = Math.round(
    scores.requirements * 0.35 +
      scores.bugs * 0.30 +
      scores.codeQuality * 0.25 +
      scores.syntax * 0.10
  );
  return { scores, overallScore };
}

export default { computeScores };
