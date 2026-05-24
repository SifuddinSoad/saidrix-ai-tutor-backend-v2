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

// Resolve the flat index of the LAST topic at a project's unlock boundary.
// Precision: sub_module when `sub_module_index` is present, else the whole
// module. Returns -1 when the boundary isn't found in the course.
function projectGateIndex(flat, unlock = {}) {
  const ch = Number(unlock?.chapter_index) || 0;
  const mod = Number(unlock?.module_index) || 0;
  const sm =
    Number.isInteger(unlock?.sub_module_index) && unlock.sub_module_index >= 0
      ? unlock.sub_module_index
      : null;

  let gateIdx = -1;
  flat.forEach((f, i) => {
    const loc = f.location;
    if (
      loc.chapter === ch &&
      loc.module === mod &&
      (sm === null || loc.sub_module === sm)
    ) {
      gateIdx = i;
    }
  });
  return gateIdx;
}

// Project unlock: a project becomes available once the learner has
// completed every topic up to and including the END of its `unlock`
// boundary (sub_module when given, else the whole module). Fails open
// when the boundary can't be located (criteria mismatch / course with no
// topics) so a metadata glitch never permanently hard-locks a project.
export function isProjectUnlocked(course, completedLocations, unlock = {}) {
  const flat = flattenTopics(course);
  if (flat.length === 0) return true;

  const gateIdx = projectGateIndex(flat, unlock);
  if (gateIdx < 0) return true; // boundary not found → fail open

  const done = new Set((completedLocations || []).map(locKey));
  for (let i = 0; i <= gateIdx; i++) {
    if (!done.has(locKey(flat[i].location))) return false;
  }
  return true;
}

// Human-readable, learner-facing hint for WHAT to finish to unlock a
// project. Prefers the most precise named boundary from the course
// outline (sub_module → module → chapter); falls back to the agent's
// stored `unlock.description`, then a generic line.
export function projectUnlockLabel(course, unlock = {}) {
  const ch = course?.chapters?.[Number(unlock?.chapter_index) || 0];
  const mod = ch?.modules?.[Number(unlock?.module_index) || 0];
  const hasSub =
    Number.isInteger(unlock?.sub_module_index) && unlock.sub_module_index >= 0;
  const sm = hasSub ? mod?.sub_modules?.[unlock.sub_module_index] : null;

  const chName = ch?.chapter_name;
  const modName = mod?.module_name;
  const smName = sm?.sub_module_name;

  if (smName) return `Finish "${smName}"${chName ? ` (${chName})` : ""}`;
  if (modName) return `Finish the "${modName}" module${chName ? ` in ${chName}` : ""}`;
  if (chName) return `Finish ${chName}`;
  return unlock?.description || "Complete the earlier lessons to unlock";
}

// Resolve a project's effective status for display/gating. A stored
// "completed" status is authoritative (the learner finished it). Otherwise
// lock/unlock is computed live from lesson progress so projects open up as
// the course is learned. Without a course to compute against, the stored
// status is returned unchanged.
export function effectiveProjectStatus(project, course, completedLocations) {
  if (project?.status === "completed") return "completed";
  if (!course) return project?.status || "locked";
  return isProjectUnlocked(course, completedLocations, project?.unlock)
    ? "unlocked"
    : "locked";
}

// A short uppercase tag for UI chips, derived from the course title.
export function courseTag(title = "") {
  const t = String(title).trim();
  if (!t) return "GEN";
  const word = t.split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "");
  return (word || t).slice(0, 6).toUpperCase();
}
