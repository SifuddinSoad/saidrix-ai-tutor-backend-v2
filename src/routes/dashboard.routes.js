// ===========================================
// Dashboard REST API
// Aggregates the authenticated user's stats, learning path, and
// projects for the /dashboard home page.
//   GET /api/dashboard/stats
// ===========================================

import { Router } from "express";
import User from "../db/models/User.js";
import Course from "../db/models/Course.js";
import Project from "../db/models/Project.js";
import LectureCompletion from "../db/models/LectureCompletion.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireActive } from "../middleware/requirePlan.js";
import { asyncHandler } from "../errors/index.js";
import {
  countTopics,
  progressPercent,
  courseTag,
  effectiveProjectStatus,
  projectUnlockLabel,
} from "../utils/courseProgress.js";

const router = Router();
router.use(authenticate, requireActive);

// Map the stored project status to the UI's three groups.
const PROJECT_STATUS_UI = {
  completed: "COMPLETE",
  unlocked: "INCOMPLETE",
  locked: "LOCKED",
};

// --- GET /api/dashboard/stats ---
router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;

    const [user, courses, projects, completions] = await Promise.all([
      User.findOne({ userId }).lean(),
      Course.find({ userId }).sort({ createdAt: -1 }).lean(),
      Project.find({ userId }).sort({ createdAt: -1 }).lean(),
      LectureCompletion.find({ userId }).select("courseId location").lean(),
    ]);

    // Group the user's completed topic-locations by course (one pass).
    const completionsByCourse = new Map();
    for (const cmp of completions) {
      const arr = completionsByCourse.get(cmp.courseId) || [];
      arr.push(cmp.location);
      completionsByCourse.set(cmp.courseId, arr);
    }
    const courseById = new Map(courses.map((c) => [c.courseId, c]));

    // Per-course progress from completion counts.
    const learningPath = courses.map((c) => {
      const totalTopics = countTopics(c);
      const completed = (completionsByCourse.get(c.courseId) || []).length;
      return {
        courseId: c.courseId,
        title: c.course_title,
        tag: courseTag(c.course_title),
        progress: progressPercent(completed, totalTopics),
        lessons: totalTopics,
        locked: false,
      };
    });

    const coursesDone = learningPath.filter((c) => c.progress === 100).length;
    const coursesInProgress = learningPath.filter(
      (c) => c.progress > 0 && c.progress < 100
    ).length;
    const projectsCompleted = projects.filter(
      (p) => p.status === "completed"
    ).length;

    const s = user?.stats || {};

    res.json({
      stats: {
        dayStreak: s.currentStreak || 0,
        longestStreak: s.longestStreak || 0,
        xp: s.xp || 0,
        coursesCount: courses.length,
        coursesInProgress,
        coursesDone,
        projectsCount: projects.length,
        projectsCompleted,
      },
      learningPath,
      projects: projects.map((p) => {
        // Lock/unlock is computed live from lesson progress so projects
        // open up as the course is learned; a stored "completed" wins.
        const course = courseById.get(p.courseId);
        const status = effectiveProjectStatus(
          p,
          course,
          completionsByCourse.get(p.courseId) || []
        );
        return {
          projectId: p.projectId,
          title: p.project_name,
          desc: p.description,
          stack: p.skills_practiced || [],
          status: PROJECT_STATUS_UI[status] || "INCOMPLETE",
          // What the learner must finish to unlock (locked cards only).
          unlockHint:
            status === "locked" ? projectUnlockLabel(course, p.unlock) : null,
        };
      }),
    });
  })
);

export default router;
