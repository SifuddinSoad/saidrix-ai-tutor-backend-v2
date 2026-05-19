// ===========================================
// Tests: parseCreateCourseCommand
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreateCourseCommand } from "../../src/agents/chat/graph.js";

test("returns null for a normal message", () => {
  assert.equal(parseCreateCourseCommand("I want to learn HTML"), null);
  assert.equal(parseCreateCourseCommand(""), null);
  assert.equal(parseCreateCourseCommand(null), null);
});

test("parses the full synthetic command (em dash, comma-rich goals)", () => {
  const msg =
    '[CreateCourse] "HTML & Semantic Markup — Basic to Advanced" — ' +
    "topic: HTML5, level: beginner, goals: full HTML, semantic tags, forms, " +
    "tables, accessibility, SEO-friendly markup, duration: 1 week";
  const r = parseCreateCourseCommand(msg);
  assert.ok(r);
  assert.equal(r.title, "HTML & Semantic Markup — Basic to Advanced");
  assert.equal(r.topic, "HTML5");
  assert.equal(r.level, "beginner");
  assert.equal(
    r.goals,
    "full HTML, semantic tags, forms, tables, accessibility, SEO-friendly markup"
  );
  assert.equal(r.duration, "1 week");
});

test("parses with only topic + level (no goals/duration)", () => {
  const r = parseCreateCourseCommand(
    '[CreateCourse] "React Basics" — topic: React, level: intermediate'
  );
  assert.ok(r);
  assert.equal(r.title, "React Basics");
  assert.equal(r.topic, "React");
  assert.equal(r.level, "intermediate");
  assert.equal(r.goals, "");
  assert.equal(r.duration, "");
});

test("invalid level falls back to beginner; topic falls back to title", () => {
  const r = parseCreateCourseCommand(
    '[CreateCourse] "Some Course" — topic: , level: wizard'
  );
  assert.ok(r);
  assert.equal(r.level, "beginner");
  assert.equal(r.topic, "Some Course");
});

test("handles a plain hyphen separator and Bangla content", () => {
  const r = parseCreateCourseCommand(
    '[CreateCourse] "বাংলা কোর্স" - topic: Python, level: advanced, goals: সব শেখা, duration: ২ সপ্তাহ'
  );
  assert.ok(r);
  assert.equal(r.title, "বাংলা কোর্স");
  assert.equal(r.topic, "Python");
  assert.equal(r.level, "advanced");
  assert.equal(r.goals, "সব শেখা");
  assert.equal(r.duration, "২ সপ্তাহ");
});
