// ===========================================
// Tests: estimateWordTimings (heuristic karaoke)
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateWordTimings } from "../../src/agents/voice-tutor/wordTimings.js";

test("returns one event per word with the matching schema", () => {
  const w = estimateWordTimings("Hello world here", 3000, { blockIndex: 4 });
  assert.equal(w.length, 3);
  for (const e of w) {
    assert.deepEqual(Object.keys(e).sort(), [
      "blockIndex",
      "endMs",
      "startMs",
      "word",
      "wordIndex",
    ]);
    assert.equal(e.blockIndex, 4);
  }
  assert.equal(w[0].word, "Hello");
  assert.equal(w[2].word, "here");
});

test("timings are contiguous, non-overlapping, monotonic", () => {
  const w = estimateWordTimings("one two three four five", 5000);
  for (let i = 0; i < w.length; i++) {
    assert.ok(w[i].endMs > w[i].startMs, `word ${i} has positive duration`);
    if (i > 0) {
      assert.equal(w[i].startMs, w[i - 1].endMs, "contiguous (no gap/overlap)");
    }
  }
});

test("covers [0, durationMs] exactly", () => {
  const w = estimateWordTimings("alpha beta gamma", 4321);
  assert.equal(w[0].startMs, 0);
  assert.equal(w[w.length - 1].endMs, 4321);
});

test("baseWordIndex offsets wordIndex", () => {
  const w = estimateWordTimings("a b c", 1000, { baseWordIndex: 10 });
  assert.equal(w[0].wordIndex, 10);
  assert.equal(w[2].wordIndex, 12);
});

test("[tags] produce no words", () => {
  const w = estimateWordTimings("[excited] Hi there [whispers] bye", 2000);
  assert.deepEqual(
    w.map((e) => e.word),
    ["Hi", "there", "bye"]
  );
});

test("longer words get proportionally more time", () => {
  const w = estimateWordTimings("a internationalization", 10000);
  const d0 = w[0].endMs - w[0].startMs;
  const d1 = w[1].endMs - w[1].startMs;
  assert.ok(d1 > d0 * 3, "long word noticeably longer than 1-char word");
});

test("sentence-final word lingers longer than a same-length mid word", () => {
  // "cat" appears twice with equal length; the one ending a sentence
  // (with '.') should get extra dwell.
  const w = estimateWordTimings("cat cat. dog", 6000);
  const plain = w[0].endMs - w[0].startMs; // "cat"
  const ending = w[1].endMs - w[1].startMs; // "cat."
  assert.ok(ending > plain, "sentence-final word dwells longer");
});

test("invalid input returns []", () => {
  assert.deepEqual(estimateWordTimings("", 1000), []);
  assert.deepEqual(estimateWordTimings("hi", 0), []);
  assert.deepEqual(estimateWordTimings("hi", -5), []);
  assert.deepEqual(estimateWordTimings(null, 1000), []);
  assert.deepEqual(estimateWordTimings("   ", 1000), []);
});
