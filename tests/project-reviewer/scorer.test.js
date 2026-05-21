// Unit tests for project-reviewer/scorer.
// Severity deductions: critical=15, warning=5, info=1, clamped [0,100].
// Overall weights: requirements 0.35, bugs 0.30, codeQuality 0.25, syntax 0.10.

import test from "node:test";
import assert from "node:assert/strict";
import { computeScores } from "../../src/agents/project-reviewer/scorer.js";

test("perfect submission returns 100 across the board", () => {
  const { scores, overallScore } = computeScores([]);
  assert.equal(scores.requirements, 100);
  assert.equal(scores.codeQuality, 100);
  assert.equal(scores.bugs, 100);
  assert.equal(scores.syntax, 100);
  assert.equal(overallScore, 100);
});

test("single critical bug deducts 15 from bugs and lowers overall", () => {
  const { scores, overallScore } = computeScores([
    { severity: "critical", category: "bugs" },
  ]);
  assert.equal(scores.bugs, 85);
  assert.equal(scores.requirements, 100);
  // Overall = 100*0.35 + 85*0.30 + 100*0.25 + 100*0.10 = 95.5 → 96
  assert.equal(overallScore, 96);
});

test("scores clamp to 0 (cannot go negative)", () => {
  const issues = Array.from({ length: 20 }, () => ({ severity: "critical", category: "requirements" }));
  const { scores } = computeScores(issues);
  assert.equal(scores.requirements, 0);
});

test("unknown severity/category does not throw", () => {
  const { scores } = computeScores([
    { severity: "unknown", category: "bugs" },
    { severity: "critical", category: "unknown" },
  ]);
  assert.equal(scores.bugs, 100);
  assert.equal(scores.requirements, 100);
});
