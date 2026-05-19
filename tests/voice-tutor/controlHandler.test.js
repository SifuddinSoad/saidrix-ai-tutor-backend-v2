// ===========================================
// Tests: control command parser + applier
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCommand,
  applyCommand,
} from "../../src/agents/voice-tutor/controlHandler.js";
import { PlayerControl, STATE } from "../../src/agents/voice-tutor/playerControl.js";

const encoder = new TextEncoder();
const encode = (obj) => encoder.encode(JSON.stringify(obj));

// --- parseCommand ---

test("parseCommand accepts pause/resume/skip/repeat", () => {
  for (const c of ["pause", "resume", "skip", "repeat"]) {
    assert.deepEqual(parseCommand(encode({ command: c })), { command: c });
  }
});

test("parseCommand accepts jump with blockIndex", () => {
  assert.deepEqual(
    parseCommand(encode({ command: "jump", blockIndex: 7 })),
    { command: "jump", blockIndex: 7 }
  );
});

test("parseCommand rejects unknown command", () => {
  assert.equal(parseCommand(encode({ command: "destroy" })), null);
});

test("parseCommand rejects malformed JSON", () => {
  assert.equal(parseCommand(encoder.encode("not json")), null);
});

test("parseCommand rejects empty/missing command", () => {
  assert.equal(parseCommand(encode({})), null);
  assert.equal(parseCommand(encode({ command: 42 })), null);
});

// --- applyCommand ---

test("applyCommand: pause sets paused state", () => {
  const pc = new PlayerControl();
  applyCommand({ command: "pause" }, pc);
  assert.equal(pc.state, STATE.PAUSED);
});

test("applyCommand: resume restores playing", () => {
  const pc = new PlayerControl();
  pc.pause("user");
  applyCommand({ command: "resume" }, pc);
  assert.equal(pc.state, STATE.PLAYING);
});

test("applyCommand: skip sets shouldSkip", () => {
  const pc = new PlayerControl();
  applyCommand({ command: "skip" }, pc);
  assert.equal(pc.shouldSkip, true);
});

test("applyCommand: repeat sets shouldRepeat", () => {
  const pc = new PlayerControl();
  applyCommand({ command: "repeat" }, pc);
  assert.equal(pc.shouldRepeat, true);
});

test("applyCommand: jump stores target index", () => {
  const pc = new PlayerControl();
  applyCommand({ command: "jump", blockIndex: 3 }, pc);
  assert.equal(pc.jumpToSegment, 3);
});

test("applyCommand: jump without blockIndex is ignored", () => {
  const pc = new PlayerControl();
  applyCommand({ command: "jump" }, pc);
  assert.equal(pc.jumpToSegment, null);
});
