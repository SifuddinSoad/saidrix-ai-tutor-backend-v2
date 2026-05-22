// ===========================================
// Course progress helpers
// A "topic" is the leaf of Course > chapters[] > modules[] >
// sub_modules[] > topics[] and maps 1:1 to a generated lecture.
// Progress = completed topics / total topics.
// ===========================================

// Total leaf topics in a course document (plain object or lean doc).
export function countTopics(course) {
  let total = 0;
  for (const ch of course?.chapters || []) {
    for (const mod of ch?.modules || []) {
      for (const sm of mod?.sub_modules || []) {
        total += (sm?.topics || []).length;
      }
    }
  }
  return total;
}

// Integer percentage [0,100]. 0 total topics → 0 (avoid divide-by-zero).
export function progressPercent(completedCount, totalTopics) {
  if (!totalTopics || totalTopics <= 0) return 0;
  return Math.min(100, Math.round((completedCount / totalTopics) * 100));
}

// Normalize a location object into a [chapter, module, sub_module, topic]
// tuple. Accepts both key conventions in the codebase:
//   LectureCompletion → { chapter, module, sub_module, topic }
//   Lecture.location  → { chapter_index, module_index, ... }
function locTuple(loc = {}) {
  return [
    loc.chapter ?? loc.chapter_index,
    loc.module ?? loc.module_index,
    loc.sub_module ?? loc.sub_module_index,
    loc.topic ?? loc.topic_index,
  ];
}

const locKey = (loc) => locTuple(loc).join("-");

// Flatten course topics into their natural learning order, each with a
// stable flat index. Order = chapters → modules → sub_modules → topics.
export function flattenTopics(course) {
  const out = [];
  (course?.chapters || []).forEach((ch, c) =>
    (ch?.modules || []).forEach((mod, m) =>
      (mod?.sub_modules || []).forEach((sm, s) =>
        (sm?.topics || []).forEach((_tp, t) => {
          out.push({
            location: { chapter: c, module: m, sub_module: s, topic: t },
            flatIndex: out.length,
          });
        })
      )
    )
  );
  return out;
}

// Sequential unlock: a topic is unlocked iff every topic before it (in
// flat order) is completed. The first topic is always unlocked. Unknown
// locations fail open so a key mismatch never hard-locks a learner.
export function isLocationUnlocked(course, completedLocations, location) {
  const flat = flattenTopics(course);
  const target = locKey(location);
  const idx = flat.findIndex((f) => locKey(f.location) === target);
  if (idx <= 0) return true;

  const done = new Set((completedLocations || []).map(locKey));
  for (let i = 0; i < idx; i++) {
    if (!done.has(locKey(flat[i].location))) return false;
  }
  return true;
}

// A short uppercase tag for UI chips, derived from the course title.
export function courseTag(title = "") {
  const t = String(title).trim();
  if (!t) return "GEN";
  const word = t.split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "");
  return (word || t).slice(0, 6).toUpperCase();
}
