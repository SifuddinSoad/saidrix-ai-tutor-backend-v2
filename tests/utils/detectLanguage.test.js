// Unit tests for the lightweight language detector.

import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "../../src/utils/detectLanguage.js";

test("empty / blank defaults to English", () => {
  assert.equal(detectLanguage(""), "English");
  assert.equal(detectLanguage("   "), "English");
  assert.equal(detectLanguage(null), "English");
});

test("Bengali script wins", () => {
  assert.equal(detectLanguage("আমি React শিখতে চাই"), "Bengali");
});

test("romanized Bengali is detected as Banglish", () => {
  assert.equal(detectLanguage("ami python shikhte chai, kibhabe korbo?"), "Banglish");
});

test("plain English stays English", () => {
  assert.equal(detectLanguage("I want to learn React hooks and state management"), "English");
});

test("a single incidental token is not enough for Banglish", () => {
  // "ase" could appear; one hit shouldn't flip a clearly-English sentence.
  assert.equal(detectLanguage("The base case ase here"), "English");
});
