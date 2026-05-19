// ===========================================
// Progress / gamification service
// Single source of truth for awarding XP and advancing the day
// streak. Completions are idempotent (LectureCompletion has a unique
// index; project completion is guarded by status) so XP and streaks
// can never be double-counted.
// ===========================================

import User from "../db/models/User.js";
import LectureCompletion from "../db/models/LectureCompletion.js";

export const XP_PER_LECTURE = 50;
export const XP_PER_PROJECT = 200;

// UTC midnight for a given date — streak math is whole-day based.
function dayStart(d) {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

// Mutate stats: bump XP and roll the streak forward for an activity now.
function applyActivity(stats, xpGain, now = new Date()) {
  stats.xp = (stats.xp || 0) + xpGain;

  const today = dayStart(now);
  const last =
    stats.lastActivityDate != null ? dayStart(stats.lastActivityDate) : null;

  if (last == null) {
    stats.currentStreak = 1;
  } else {
    const diffDays = Math.round((today - last) / 86400000);
    if (diffDays === 0) {
      // Already active today — XP still counts, streak unchanged.
    } else if (diffDays === 1) {
      stats.currentStreak = (stats.currentStreak || 0) + 1;
    } else {
      stats.currentStreak = 1; // missed a day → reset
    }
  }

  stats.longestStreak = Math.max(
    stats.longestStreak || 0,
    stats.currentStreak || 0
  );
  stats.lastActivityDate = new Date(today);
  return stats;
}

async function bumpUser(userId, xpGain) {
  const user = await User.findOne({ userId });
  if (!user) return null;
  user.stats = applyActivity(user.stats || {}, xpGain);
  user.markModified("stats");
  await user.save();
  return user.stats;
}

// Award a lecture/topic completion. Idempotent via the unique index:
// a repeat completion inserts nothing and awards no XP.
// Returns { newlyCompleted, stats }.
export async function completeLecture(userId, courseId, location) {
  let newlyCompleted = true;
  try {
    await LectureCompletion.create({ userId, courseId, location });
  } catch (err) {
    if (err && err.code === 11000) {
      newlyCompleted = false;
    } else {
      throw err;
    }
  }

  let stats;
  if (newlyCompleted) {
    stats = await bumpUser(userId, XP_PER_LECTURE);
  } else {
    const user = await User.findOne({ userId }).lean();
    stats = user?.stats || null;
  }
  return { newlyCompleted, stats };
}

// Award project completion XP (once). Caller flips Project.status;
// pass wasAlreadyCompleted so XP is granted only on the first time.
export async function completeProject(userId, wasAlreadyCompleted) {
  if (wasAlreadyCompleted) {
    const user = await User.findOne({ userId }).lean();
    return { newlyCompleted: false, stats: user?.stats || null };
  }
  const stats = await bumpUser(userId, XP_PER_PROJECT);
  return { newlyCompleted: true, stats };
}

export default { completeLecture, completeProject, XP_PER_LECTURE, XP_PER_PROJECT };
