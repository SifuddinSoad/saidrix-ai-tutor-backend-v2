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

// A short uppercase tag for UI chips, derived from the course title.
export function courseTag(title = "") {
  const t = String(title).trim();
  if (!t) return "GEN";
  const word = t.split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "");
  return (word || t).slice(0, 6).toUpperCase();
}
