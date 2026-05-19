// ===========================================
// Tests: extractProposal
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProposal } from "../../src/agents/chat/extractProposal.js";

test("returns null proposal when no proposal block", () => {
  const { cleanedText, proposal } = extractProposal("Just a normal reply.");
  assert.equal(proposal, null);
  assert.equal(cleanedText, "Just a normal reply.");
});

test("parses a valid proposal block and strips it from text", () => {
  const text =
    'Here is what I recommend.\n\n```proposal\n' +
    JSON.stringify({
      intro: "Based on your answers",
      courses: [
        {
          title: "JavaScript Fundamentals",
          topic: "JavaScript",
          level: "beginner",
          goals: "core JS",
          duration: "2 weeks",
          rationale: "weak basics",
        },
      ],
    }) +
    "\n```";

  const { cleanedText, proposal } = extractProposal(text);
  assert.equal(cleanedText, "Here is what I recommend.");
  assert.ok(proposal);
  assert.equal(proposal.intro, "Based on your answers");
  assert.equal(proposal.courses.length, 1);
  assert.equal(proposal.courses[0].title, "JavaScript Fundamentals");
  assert.equal(proposal.courses[0].level, "beginner");
  assert.ok(typeof proposal.courses[0].id === "string" && proposal.courses[0].id.length > 0);
});

test("defaults invalid level to beginner and drops invalid courses", () => {
  const text =
    "```proposal\n" +
    JSON.stringify({
      courses: [
        { title: "A", topic: "A", level: "wizard" },
        { title: "no topic" },
        { topic: "no title" },
      ],
    }) +
    "\n```";

  const { proposal } = extractProposal(text);
  assert.equal(proposal.courses.length, 1);
  assert.equal(proposal.courses[0].level, "beginner");
});

test("returns null when courses array is empty or missing", () => {
  const a = extractProposal("```proposal\n{\"courses\":[]}\n```");
  assert.equal(a.proposal, null);
  const b = extractProposal("```proposal\n{\"intro\":\"hi\"}\n```");
  assert.equal(b.proposal, null);
});

test("malformed JSON leaves the block intact and proposal null", () => {
  const text = "```proposal\n{ not json }\n```";
  const { cleanedText, proposal } = extractProposal(text);
  assert.equal(proposal, null);
  assert.ok(cleanedText.includes("```proposal"));
});
