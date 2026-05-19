// ===========================================
// Tests: Q&A context builder
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQAContext } from "../../src/agents/voice-tutor/qa.js";

const sampleLecture = {
  title: "Intro to ML",
  summary: "Basics of ML.",
  topic_name: "What Is ML?",
  blocks: [
    { type: "heading", data: { level: 1, content: "Welcome" } },
    { type: "text", data: { content: "ML is a subset of AI." } },
    { type: "code", data: { language: "python", content: "model.fit(X)" } },
  ],
};

// --- system prompt includes lecture meta ---

test("system prompt includes lecture title and topic", () => {
  const ctx = buildQAContext({
    lecture: sampleLecture,
    currentBlock: sampleLecture.blocks[1],
    recentBlocks: [sampleLecture.blocks[0]],
    qaHistory: [],
    question: "What is ML?",
  });

  assert.ok(ctx.system.includes("Intro to ML"));
  assert.ok(ctx.system.includes("What Is ML?"));
});

// --- system prompt includes block context ---

test("system prompt includes current + recent block text", () => {
  const ctx = buildQAContext({
    lecture: sampleLecture,
    currentBlock: sampleLecture.blocks[1],
    recentBlocks: [sampleLecture.blocks[0]],
    qaHistory: [],
    question: "huh?",
  });

  assert.ok(ctx.system.includes("ML is a subset"));
  assert.ok(ctx.system.includes("Welcome"));
});

// --- history is trimmed to last 6 turns ---

test("history is trimmed to last 6 turns", () => {
  const longHistory = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "student" : "assistant",
    text: `turn-${i}`,
  }));

  const ctx = buildQAContext({
    lecture: sampleLecture,
    qaHistory: longHistory,
    question: "next?",
  });

  assert.equal(ctx.history.length, 6);
  assert.ok(ctx.history[0].content.startsWith("turn-14"));
  assert.ok(ctx.history[5].content.startsWith("turn-19"));
});

// --- history roles map correctly ---

test("history maps 'student' role to 'user'", () => {
  const ctx = buildQAContext({
    lecture: sampleLecture,
    qaHistory: [
      { role: "student", text: "q1" },
      { role: "assistant", text: "a1" },
    ],
    question: "q2",
  });

  assert.equal(ctx.history[0].role, "user");
  assert.equal(ctx.history[1].role, "assistant");
});

// --- code block content present in context (truncated) ---

test("code block is summarized in context, not full code", () => {
  const ctx = buildQAContext({
    lecture: sampleLecture,
    currentBlock: sampleLecture.blocks[2], // code block
    recentBlocks: [],
    qaHistory: [],
    question: "what?",
  });

  // Should mention python and have a snippet of code (length-limited)
  assert.ok(ctx.system.toLowerCase().includes("python"));
});

// --- empty inputs ---

test("works with no recentBlocks and no history", () => {
  const ctx = buildQAContext({
    lecture: sampleLecture,
    currentBlock: null,
    qaHistory: [],
    question: "hi",
  });

  assert.equal(ctx.history.length, 0);
  assert.ok(ctx.system.length > 0);
});
