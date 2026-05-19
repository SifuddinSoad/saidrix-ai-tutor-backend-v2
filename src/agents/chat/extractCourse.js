// ===========================================
// extractCourseRefs — pulls fenced ```course {...}``` blocks out of
// the assistant's response. The chat agent appends one of these after
// create_course returns so the client can render an interactive
// course-preview card.
// ===========================================

import logger from "../../utils/logger.js";

const FENCE_RE = /```course\s*\n([\s\S]*?)\n?```/g;

export function extractCourseRefs(text) {
  if (typeof text !== "string" || !text.includes("```course")) {
    return { cleanedText: text || "", courseRefs: [] };
  }

  const refs = [];
  const cleanedText = text.replace(FENCE_RE, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      if (parsed && typeof parsed.courseId === "string") {
        refs.push({ courseId: parsed.courseId, ...parsed });
        return "";
      }
    } catch (err) {
      logger.warn(`[extractCourseRefs] parse failed: ${err.message}`);
    }
    return match;
  }).replace(/\n{3,}/g, "\n\n").trim();

  return { cleanedText, courseRefs: refs };
}

export default extractCourseRefs;
