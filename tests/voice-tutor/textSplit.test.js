// ===========================================
// Tests: splitSentences / takeLeadingSentence
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitSentences,
  takeLeadingSentence,
} from "../../src/agents/voice-tutor/textSplit.js";

test("splits on . ! ? and keeps punctuation", () => {
  assert.deepEqual(splitSentences("Hi there. How are you? Great!"), [
    "Hi there.",
    "How are you?",
    "Great!",
  ]);
});

test("trailing fragment without punctuation is its own sentence", () => {
  assert.deepEqual(splitSentences("Done. And more text"), [
    "Done.",
    "And more text",
  ]);
});

test("no terminal punctuation → whole string", () => {
  assert.deepEqual(splitSentences("Section: Intro"), ["Section: Intro"]);
});

test("empty / non-string → []", () => {
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("   "), []);
  assert.deepEqual(splitSentences(null), []);
});

test("takeLeadingSentence pulls one complete sentence", () => {
  const r = takeLeadingSentence("First one. Second one. ");
  assert.equal(r.sentence, "First one.");
  assert.equal(r.rest, "Second one. ");
});

test("takeLeadingSentence returns null without a complete sentence", () => {
  assert.equal(takeLeadingSentence("incomplete sentence with no end"), null);
  assert.equal(takeLeadingSentence(""), null);
});
