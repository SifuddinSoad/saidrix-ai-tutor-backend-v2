// Unit tests for project unlock enforcement (courseProgress helpers).
// A project unlocks once the learner has completed every topic up to and
// including the END of the module its `unlock` criteria points at.

import test from "node:test";
import assert from "node:assert/strict";
import {
  isProjectUnlocked,
  effectiveProjectStatus,
  projectUnlockLabel,
} from "../../src/utils/courseProgress.js";

// Course flat order:
//   idx0: c0 m0 s0 t0
//   idx1: c0 m0 s0 t1
//   idx2: c0 m1 s0 t0
//   idx3: c1 m0 s0 t0
const course = {
  chapters: [
    {
      modules: [
        { sub_modules: [{ topics: [{}, {}] }] }, // c0 m0 → 2 topics
        { sub_modules: [{ topics: [{}] }] }, // c0 m1 → 1 topic
      ],
    },
    {
      modules: [{ sub_modules: [{ topics: [{}] }] }], // c1 m0 → 1 topic
    },
  ],
};

// Named course for sub_module-precision + label tests.
//   idx0: c0 m0 s0 t0
//   idx1: c0 m0 s1 t0  ← gate when sub_module_index: 1
//   idx2: c0 m0 s1 t1
const namedCourse = {
  chapters: [
    {
      chapter_name: "Chapter One",
      modules: [
        {
          module_name: "Module A",
          sub_modules: [
            { sub_module_name: "Basics", topics: [{}] },
            { sub_module_name: "Advanced", topics: [{}, {}] },
          ],
        },
      ],
    },
  ],
};

const loc = (chapter, module, sub_module, topic) => ({
  chapter,
  module,
  sub_module,
  topic,
});

test("locked when no topics completed", () => {
  const unlock = { chapter_index: 0, module_index: 0 };
  assert.equal(isProjectUnlocked(course, [], unlock), false);
});

test("still locked when only part of the gating module is done", () => {
  const unlock = { chapter_index: 0, module_index: 0 };
  const done = [loc(0, 0, 0, 0)]; // idx0 done, idx1 missing
  assert.equal(isProjectUnlocked(course, done, unlock), false);
});

test("unlocks once the whole gating module is completed", () => {
  const unlock = { chapter_index: 0, module_index: 0 };
  const done = [loc(0, 0, 0, 0), loc(0, 0, 0, 1)];
  assert.equal(isProjectUnlocked(course, done, unlock), true);
});

test("gating on a later module requires all prior topics too", () => {
  const unlock = { chapter_index: 0, module_index: 1 };
  // idx2 done but idx0/idx1 missing → still locked
  assert.equal(isProjectUnlocked(course, [loc(0, 1, 0, 0)], unlock), false);
  // all of idx0..idx2 done → unlocked
  const done = [loc(0, 0, 0, 0), loc(0, 0, 0, 1), loc(0, 1, 0, 0)];
  assert.equal(isProjectUnlocked(course, done, unlock), true);
});

test("fails open when the unlock module is not in the course", () => {
  const unlock = { chapter_index: 9, module_index: 9 };
  assert.equal(isProjectUnlocked(course, [], unlock), true);
});

test("fails open for a course with no topics", () => {
  assert.equal(isProjectUnlocked({ chapters: [] }, [], {}), true);
});

test("effectiveProjectStatus keeps a completed project completed", () => {
  const p = { status: "completed", unlock: { chapter_index: 0, module_index: 0 } };
  assert.equal(effectiveProjectStatus(p, course, []), "completed");
});

test("effectiveProjectStatus computes unlocked from progress", () => {
  const p = { status: "locked", unlock: { chapter_index: 0, module_index: 0 } };
  assert.equal(effectiveProjectStatus(p, course, []), "locked");
  const done = [loc(0, 0, 0, 0), loc(0, 0, 0, 1)];
  assert.equal(effectiveProjectStatus(p, course, done), "unlocked");
});

test("effectiveProjectStatus falls back to stored status without a course", () => {
  const p = { status: "locked", unlock: {} };
  assert.equal(effectiveProjectStatus(p, null, []), "locked");
});

test("sub_module_index gates at the sub_module, not the whole module", () => {
  const unlock = { chapter_index: 0, module_index: 0, sub_module_index: 1 };
  // Need idx0 (s0) + idx1,idx2 (s1) all done. Only s0 done → locked.
  const s0 = [loc(0, 0, 0, 0)];
  assert.equal(isProjectUnlocked(namedCourse, s0, unlock), false);
  // Whole sub_module 1 done too → unlocked.
  const all = [loc(0, 0, 0, 0), loc(0, 0, 1, 0), loc(0, 0, 1, 1)];
  assert.equal(isProjectUnlocked(namedCourse, all, unlock), true);
  // First sub_module (index 0) gate → just idx0 unlocks it.
  const unlock0 = { chapter_index: 0, module_index: 0, sub_module_index: 0 };
  assert.equal(isProjectUnlocked(namedCourse, s0, unlock0), true);
});

test("projectUnlockLabel prefers the sub_module name", () => {
  const unlock = { chapter_index: 0, module_index: 0, sub_module_index: 1 };
  assert.equal(
    projectUnlockLabel(namedCourse, unlock),
    'Finish "Advanced" (Chapter One)'
  );
});

test("projectUnlockLabel falls back to module then description", () => {
  // No sub_module_index → module-level label.
  assert.equal(
    projectUnlockLabel(namedCourse, { chapter_index: 0, module_index: 0 }),
    'Finish the "Module A" module in Chapter One'
  );
  // No course names available → stored description.
  assert.equal(
    projectUnlockLabel(null, { description: "Do the intro first" }),
    "Do the intro first"
  );
});
