// ===========================================
// Tests: PlayerControl state machine
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayerControl, STATE } from "../../src/agents/voice-tutor/playerControl.js";

// --- Initial state ---

test("initial state is playing", () => {
  const pc = new PlayerControl();
  assert.equal(pc.state, STATE.PLAYING);
  assert.equal(pc.isPlaying(), true);
  assert.equal(pc.isAborting(), false);
});

// --- pause/resume ---

test("pause sets state and resume restores it", () => {
  const pc = new PlayerControl();
  pc.pause("user");
  assert.equal(pc.state, STATE.PAUSED);
  assert.equal(pc.pauseReason, "user");
  pc.resume();
  assert.equal(pc.state, STATE.PLAYING);
  assert.equal(pc.pauseReason, null);
});

// --- enterQA/exitQA ---

test("enterQA → in_qa → exitQA → playing", () => {
  const pc = new PlayerControl();
  pc.enterQA();
  assert.equal(pc.state, STATE.IN_QA);
  pc.exitQA();
  assert.equal(pc.state, STATE.PLAYING);
});

// --- skip flag sets abort ---

test("requestSkip sets shouldSkip and shouldAbortSegment", () => {
  const pc = new PlayerControl();
  pc.requestSkip();
  assert.equal(pc.shouldSkip, true);
  assert.equal(pc.shouldAbortSegment, true);
  assert.equal(pc.isAborting(), true);
});

test("requestRepeat sets shouldRepeat and shouldAbortSegment", () => {
  const pc = new PlayerControl();
  pc.requestRepeat();
  assert.equal(pc.shouldRepeat, true);
  assert.equal(pc.shouldAbortSegment, true);
});

test("requestJump stores target index", () => {
  const pc = new PlayerControl();
  pc.requestJump(5);
  assert.equal(pc.jumpToSegment, 5);
  assert.equal(pc.shouldAbortSegment, true);
});

test("requestJump ignores invalid index", () => {
  const pc = new PlayerControl();
  pc.requestJump(-1);
  pc.requestJump("foo");
  assert.equal(pc.jumpToSegment, null);
});

// --- clearSegmentFlags resets ---

test("clearSegmentFlags resets all segment flags", () => {
  const pc = new PlayerControl();
  pc.requestSkip();
  pc.clearSegmentFlags();
  assert.equal(pc.shouldSkip, false);
  assert.equal(pc.shouldAbortSegment, false);
});

// --- complete transitions to terminal ---

test("complete marks state and waiters are released", async () => {
  const pc = new PlayerControl();
  pc.pause("user");

  const waitPromise = pc.waitIfPaused();
  pc.complete();
  await waitPromise; // should resolve

  assert.equal(pc.state, STATE.COMPLETED);
});

// --- waitIfPaused resolves on resume ---

test("waitIfPaused resolves when resume() is called", async () => {
  const pc = new PlayerControl();
  pc.pause("user");

  let resolved = false;
  const p = pc.waitIfPaused().then(() => { resolved = true; });

  // Not resolved yet
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);

  pc.resume();
  await p;
  assert.equal(resolved, true);
});

// --- segmentChange event ---

test("setSegmentIdx emits segmentChange only when index changes", () => {
  const pc = new PlayerControl();
  let count = 0;
  pc.on("segmentChange", () => count++);
  pc.setSegmentIdx(0); // same as initial 0 → no emit
  pc.setSegmentIdx(1);
  pc.setSegmentIdx(1); // same → no emit
  pc.setSegmentIdx(2);
  assert.equal(count, 2);
});
