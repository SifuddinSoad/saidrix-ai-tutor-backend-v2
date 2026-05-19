// ===========================================
// extractProposal — pulls a fenced ```proposal {...}``` block out of
// the assistant's response. The chat agent emits ONE of these after
// finishing the knowledge assessment so the client can render an
// interactive course-proposal card (one "Create" button per course).
//
// Shape:
//   { "intro": "…", "courses": [
//       { "title": "…", "topic": "…", "level": "beginner|intermediate|advanced",
//         "goals": "…", "duration": "…", "rationale": "…" }, … ] }
// ===========================================

import { randomUUID } from "node:crypto";
import logger from "../../utils/logger.js";

const FENCE_RE = /```proposal\s*\n([\s\S]*?)\n?```/g;

export function extractProposal(text) {
  if (typeof text !== "string" || !text.includes("```proposal")) {
    return { cleanedText: text || "", proposal: null };
  }

  let proposal = null;

  const cleanedText = text
    .replace(FENCE_RE, (match, body) => {
      if (proposal) return ""; // only the first valid block wins
      try {
        const parsed = JSON.parse(body.trim());
        const courses = Array.isArray(parsed?.courses) ? parsed.courses : null;
        if (!courses || courses.length === 0) return match;

        const normalized = courses
          .map((c) => {
            if (!c || typeof c.title !== "string" || typeof c.topic !== "string") {
              return null;
            }
            const level = ["beginner", "intermediate", "advanced"].includes(
              c.level
            )
              ? c.level
              : "beginner";
            return {
              id: typeof c.id === "string" && c.id ? c.id : randomUUID(),
              title: c.title,
              topic: c.topic,
              level,
              goals: typeof c.goals === "string" ? c.goals : "",
              duration: typeof c.duration === "string" ? c.duration : "",
              rationale: typeof c.rationale === "string" ? c.rationale : "",
            };
          })
          .filter(Boolean);

        if (normalized.length === 0) return match;

        proposal = {
          intro: typeof parsed.intro === "string" ? parsed.intro : "",
          courses: normalized,
        };
        return "";
      } catch (err) {
        logger.warn(`[extractProposal] parse failed: ${err.message}`);
        return match;
      }
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanedText, proposal };
}

export default extractProposal;
