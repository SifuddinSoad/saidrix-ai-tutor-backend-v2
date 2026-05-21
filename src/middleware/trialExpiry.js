// ===========================================
// trialExpiry — lazy "trial has ended" status update.
// Runs after `authenticate` on any route that already loads
// the user identity. Fires at most once per user (only when
// status flips from non-expired -> expired). Cheap: a single
// updateOne with a guard predicate, no extra read.
// ===========================================

import User from "../db/models/User.js";

export async function trialExpiry(req, _res, next) {
  try {
    if (!req.user?.userId) return next();
    if (req.user.plan !== "free_trial") return next();
    // Token payload doesn't carry trialEndsAt — do one cheap predicate update.
    await User.updateOne(
      {
        userId: req.user.userId,
        plan: "free_trial",
        status: { $ne: "expired" },
        trialEndsAt: { $lt: new Date() },
      },
      { $set: { status: "expired" } }
    );
    return next();
  } catch (err) {
    // Never block a request on this — log via central handler.
    return next(err);
  }
}

export default trialExpiry;
