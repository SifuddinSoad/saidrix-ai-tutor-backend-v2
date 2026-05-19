// ===========================================
// Tests: alignmentToWords
// Verifies char-level → word-level conversion,
// including ElevenLabs v3 audio tag exclusion.
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { alignmentToWords } from "../../src/agents/voice-tutor/alignmentToWords.js";

// --- Simple two-word case ---

test("converts 'Hello world' to two word events", () => {
  const alignment = {
    chars: ["H", "e", "l", "l", "o", " ", "w", "o", "r", "l", "d"],
    charStartTimesMs: [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
    charDurationsMs: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  };
  const words = alignmentToWords(alignment, 0, 0, 0);
  assert.equal(words.length, 2);
  assert.equal(words[0].word, "Hello");
  assert.equal(words[1].word, "world");
});

// --- Punctuation stays attached ---

test("keeps punctuation attached to words", () => {
  const alignment = {
    chars: ["H", "i", ",", " ", "y", "o", "u", "!"],
    charStartTimesMs: [0, 50, 100, 150, 200, 250, 300, 350],
    charDurationsMs: [50, 50, 50, 50, 50, 50, 50, 50],
  };
  const words = alignmentToWords(alignment, 0);
  assert.equal(words.length, 2);
  assert.equal(words[0].word, "Hi,");
  assert.equal(words[1].word, "you!");
});

// --- Base offset is added ---

test("applies baseOffsetMs to all timings", () => {
  const alignment = {
    chars: ["A", " ", "B"],
    charStartTimesMs: [0, 100, 200],
    charDurationsMs: [100, 100, 100],
  };
  const words = alignmentToWords(alignment, 0, 1000, 5);
  assert.equal(words[0].startMs, 1000);
  assert.equal(words[0].wordIndex, 5);
});

// --- Empty / multiple whitespace handled ---

test("handles multiple spaces without producing empty words", () => {
  const alignment = {
    chars: ["A", " ", " ", " ", "B"],
    charStartTimesMs: [0, 100, 200, 300, 400],
    charDurationsMs: [100, 100, 100, 100, 100],
  };
  const words = alignmentToWords(alignment, 0);
  assert.equal(words.length, 2);
});

// --- Invalid input ---

test("returns empty array for missing alignment", () => {
  assert.deepEqual(alignmentToWords(null, 0), []);
  assert.deepEqual(alignmentToWords({}, 0), []);
  assert.deepEqual(alignmentToWords({ chars: [] }, 0), []);
});

// ===========================================
// Audio Tag Exclusion (ElevenLabs v3)
// ===========================================

test("skips [tag] segments — tags are not emitted as words", () => {
  // text: "[excited] Hi"
  const alignment = {
    chars: ["[", "e", "x", "c", "i", "t", "e", "d", "]", " ", "H", "i"],
    charStartTimesMs: [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550],
    charDurationsMs: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  };
  const words = alignmentToWords(alignment, 0);
  assert.equal(words.length, 1);
  assert.equal(words[0].word, "Hi");
});

test("handles multiple tags in sequence", () => {
  // text: "[excited] Hi [whispers] bye"
  const buildChars = (s) => {
    const chars = [];
    const starts = [];
    const durs = [];
    for (let i = 0; i < s.length; i++) {
      chars.push(s[i]);
      starts.push(i * 50);
      durs.push(50);
    }
    return { chars, charStartTimesMs: starts, charDurationsMs: durs };
  };
  const a = buildChars("[excited] Hi [whispers] bye");
  const words = alignmentToWords(a, 0);
  assert.equal(words.length, 2);
  assert.equal(words[0].word, "Hi");
  assert.equal(words[1].word, "bye");
});

test("tag with internal word doesn't leak the word", () => {
  // text: "[long pause] ok"
  const buildChars = (s) => {
    const chars = [];
    const starts = [];
    const durs = [];
    for (let i = 0; i < s.length; i++) {
      chars.push(s[i]);
      starts.push(i * 10);
      durs.push(10);
    }
    return { chars, charStartTimesMs: starts, charDurationsMs: durs };
  };
  const a = buildChars("[long pause] ok");
  const words = alignmentToWords(a, 0);
  assert.equal(words.length, 1);
  assert.equal(words[0].word, "ok");
});
