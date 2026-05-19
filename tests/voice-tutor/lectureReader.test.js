// ===========================================
// Tests: lectureReader
// Verifies block → speech text conversion
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockToSpeech,
  lectureToSpeechPlan,
} from "../../src/agents/voice-tutor/lectureReader.js";

// --- Heading levels ---

test("heading level 1 starts with 'Chapter:'", () => {
  const text = blockToSpeech({
    type: "heading",
    data: { level: 1, content: "Foundations" },
  });
  assert.ok(text.includes("Chapter:"));
  assert.ok(text.includes("Foundations"));
});

test("heading level 2 starts with 'Section:'", () => {
  const text = blockToSpeech({
    type: "heading",
    data: { level: 2, content: "Variables" },
  });
  assert.ok(text.includes("Section:"));
});

// --- Code is described, not read ---

test("code block mentions screen and language, not raw code", () => {
  const text = blockToSpeech({
    type: "code",
    data: { language: "python", content: "print('hi')" },
  });
  assert.ok(text.toLowerCase().includes("screen"));
  assert.ok(text.includes("python"));
  assert.ok(!text.includes("print('hi')"));
});

// --- Image reads description ---

test("image reads description, not URL", () => {
  const text = blockToSpeech({
    type: "image",
    data: {
      placeholder_url: "https://example.com/x.png",
      alt: "Diagram",
      description: "a flowchart of HTTP request lifecycle",
    },
  });
  assert.ok(text.includes("flowchart"));
  assert.ok(!text.includes("https://"));
});

// --- Ordered list uses ordinals ---

test("ordered list uses ordinals", () => {
  const text = blockToSpeech({
    type: "list",
    data: { style: "ordered", items: ["alpha", "beta", "gamma"] },
  });
  assert.ok(text.includes("First"));
  assert.ok(text.includes("Second"));
  assert.ok(text.includes("Third"));
});

// --- Callout includes style label ---

test("callout includes appropriate label", () => {
  const t1 = blockToSpeech({
    type: "callout",
    data: { style: "warning", content: "Be careful" },
  });
  assert.ok(t1.includes("Warning"));

  const t2 = blockToSpeech({
    type: "callout",
    data: { style: "tip", content: "Pro tip here" },
  });
  assert.ok(t2.includes("Tip"));
});

// --- Markdown stripping ---

test("text block strips markdown bold/italic", () => {
  const text = blockToSpeech({
    type: "text",
    data: { content: "This is **bold** and *italic* and `code` here." },
  });
  assert.ok(!text.includes("**"));
  assert.ok(!text.includes("*italic*"));
  assert.ok(!text.includes("`"));
  assert.ok(text.includes("bold"));
});

// --- Speech plan includes title + summary + blocks, skips empty ---

test("lectureToSpeechPlan includes title and skips empty blocks", () => {
  const lecture = {
    title: "Intro to ML",
    summary: "Learn the basics.",
    blocks: [
      { type: "heading", data: { level: 1, content: "Welcome" } },
      { type: "text", data: { content: "" } }, // empty — skipped
      { type: "text", data: { content: "Hello" } },
    ],
  };
  const plan = lectureToSpeechPlan(lecture);

  // title + summary + heading + non-empty text = 4 segments
  assert.equal(plan.length, 4);
  assert.ok(plan[0].text.includes("Intro to ML"));
  assert.ok(plan[1].text.includes("Learn the basics"));
  assert.equal(plan[2].blockIndex, 0);
  assert.equal(plan[3].blockIndex, 2); // index 1 was skipped
});

// --- Unknown block types return empty ---

test("unknown block type returns empty string", () => {
  assert.equal(blockToSpeech({ type: "unknown", data: {} }), "");
  assert.equal(blockToSpeech(null), "");
});
