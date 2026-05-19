// ===========================================
// Tests: extractAskBlocks (fence-independent)
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAskBlocks } from "../../src/agents/chat/extractAsk.js";

const QJSON = {
  questions: [
    {
      header: "SKILL LEVEL",
      question: "What's your current experience with HTML?",
      multiSelect: false,
      options: [
        { label: "Complete beginner", description: "Never written HTML" },
        { label: "Some basics", description: "Tried a few pages" },
      ],
    },
    {
      header: "GOAL",
      question: "Why do you want to learn HTML?",
      multiSelect: false,
      options: [{ label: "Career" }, { label: "Hobby" }],
    },
  ],
};

test("parses a proper ```ask fenced block", () => {
  const text = "Age koyekta question:\n```ask\n" + JSON.stringify(QJSON) + "\n```";
  const { cleanedText, prompts } = extractAskBlocks(text);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].header, "SKILL LEVEL");
  assert.ok(!cleanedText.includes("questions"));
  assert.ok(!cleanedText.includes("```"));
});

test("parses BARE nested JSON with no fence (the reported bug)", () => {
  const text =
    "Sifuddin, great choice!\n" + JSON.stringify(QJSON, null, 2);
  const { cleanedText, prompts } = extractAskBlocks(text);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].options.length, 2);
  assert.ok(!cleanedText.includes('"questions"'));
  assert.equal(cleanedText.trim(), "Sifuddin, great choice!");
});

test("parses ```json mislabelled fence", () => {
  const text = "```json\n" + JSON.stringify(QJSON) + "\n```";
  const { prompts } = extractAskBlocks(text);
  assert.equal(prompts.length, 2);
});

test("ignores normal JSON without a questions array", () => {
  const text = 'Here is config:\n```json\n{ "a": 1, "b": { "c": 2 } }\n```';
  const { cleanedText, prompts } = extractAskBlocks(text);
  assert.equal(prompts.length, 0);
  assert.ok(cleanedText.includes('"a": 1'));
});

test("no questions → text untouched", () => {
  const { cleanedText, prompts } = extractAskBlocks("just a normal reply");
  assert.equal(prompts.length, 0);
  assert.equal(cleanedText, "just a normal reply");
});

test("braces inside string values don't break parsing", () => {
  const q = {
    questions: [
      {
        question: "Pick syntax",
        options: [{ label: "Object {x:1}", description: "uses { and }" }],
      },
    ],
  };
  const { prompts } = extractAskBlocks("```ask\n" + JSON.stringify(q) + "\n```");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].options[0].label, "Object {x:1}");
});
