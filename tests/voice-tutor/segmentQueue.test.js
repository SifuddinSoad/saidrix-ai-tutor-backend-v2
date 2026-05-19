// ===========================================
// Tests: SegmentQueue (bounded async FIFO)
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SegmentQueue,
  QUEUE_CLOSED,
} from "../../src/agents/voice-tutor/segmentQueue.js";

test("FIFO order", async () => {
  const q = new SegmentQueue(4);
  await q.push("a");
  await q.push("b");
  await q.push("c");
  assert.equal(await q.shift(), "a");
  assert.equal(await q.shift(), "b");
  assert.equal(await q.shift(), "c");
});

test("push blocks when full, unblocks on shift", async () => {
  const q = new SegmentQueue(2);
  await q.push(1);
  await q.push(2);
  let pushed = false;
  const p = q.push(3).then(() => {
    pushed = true;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pushed, false, "3rd push is blocked while full");
  assert.equal(await q.shift(), 1);
  await p;
  assert.equal(pushed, true, "push resumed after a slot freed");
  assert.equal(q.size, 2);
});

test("shift blocks when empty, unblocks on push", async () => {
  const q = new SegmentQueue(2);
  let got;
  const s = q.shift().then((v) => {
    got = v;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(got, undefined, "shift is blocked while empty");
  await q.push("x");
  await s;
  assert.equal(got, "x");
});

test("close() makes a blocked shift return the sentinel", async () => {
  const q = new SegmentQueue(2);
  const s = q.shift();
  q.close();
  assert.equal(await s, QUEUE_CLOSED);
});

test("close() then shift drains remaining then sentinel", async () => {
  const q = new SegmentQueue(4);
  await q.push("only");
  q.close();
  assert.equal(await q.shift(), "only");
  assert.equal(await q.shift(), QUEUE_CLOSED);
  assert.equal(q.closed, true);
});

test("push after close returns false", async () => {
  const q = new SegmentQueue(2);
  q.close();
  assert.equal(await q.push("nope"), false);
});

test("clear() empties and frees blocked pushers", async () => {
  const q = new SegmentQueue(1);
  await q.push("a");
  let second = false;
  const p = q.push("b").then(() => {
    second = true;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(second, false);
  q.clear();
  await p;
  assert.equal(second, true, "blocked push resumed after clear");
  // 'a' was cleared; only 'b' remains
  assert.equal(await q.shift(), "b");
});
