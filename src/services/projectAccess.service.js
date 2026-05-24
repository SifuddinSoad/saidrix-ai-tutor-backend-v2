// ===========================================
// Project access service
// Single source of truth for a project's LIVE lock/unlock state and the
// hard gate that blocks acting on a still-locked project. Mirrors the
// lecture/voice sequential-unlock enforcement so a learner can't bypass
// the locked roadmap UI by hitting the API directly.
// ===========================================

import Course from "../db/models/Course.js";
import LectureCompletion from "../db/models/LectureCompletion.js";
import { effectiveProjectStatus } from "../utils/courseProgress.js";
import { ForbiddenError } from "../errors/index.js";

// Compute a project's effective status ("locked" | "unlocked" |
// "completed") from the learner's lesson progress in its course.
export async function resolveProjectStatus(project, userId) {
  const [course, completions] = await Promise.all([
    Course.findOne({ courseId: project.courseId }).lean(),
    LectureCompletion.find({ userId, courseId: project.courseId })
      .select("location -_id")
      .lean(),
  ]);
  return effectiveProjectStatus(
    project,
    course,
    completions.map((c) => c.location)
  );
}

// Throw 403 when the project is still locked. Returns the resolved status
// otherwise so callers can reuse it without a second computation.
export async function assertProjectUnlocked(project, userId) {
  const status = await resolveProjectStatus(project, userId);
  if (status === "locked") {
    throw new ForbiddenError(
      "Complete the required lessons to unlock this project"
    );
  }
  return status;
}
