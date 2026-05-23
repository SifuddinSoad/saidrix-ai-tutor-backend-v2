// ===========================================
// accountStatus — authoritative access-status resolver.
// The access JWT carries a `status` claim, but that snapshot goes
// stale (a trial can lapse mid-token, and refresh would otherwise
// keep re-issuing "trialing"). This reads the live User record and
// lazily expires a free trial whose window has passed, so gates can
// never be fooled by a stale token.
// ===========================================

import User from "../db/models/User.js";

const ACTIVE_STATUSES = ["trialing", "active"];

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Resolve a user's authoritative access status. If a free trial has
 * elapsed, flips the DB status to "expired" (idempotent) so the change
 * propagates to future token refreshes and billing reads.
 *
 * @param {string} userId
 * @returns {Promise<{ status: string, plan: string } | null>} null if no such user
 */
export async function resolveAccountStatus(userId) {
  const user = await User.findOne({ userId })
    .select("status plan trialEndsAt")
    .lean();
  if (!user) return null;

  let status = user.status;
  const trialExpired =
    user.plan === "free_trial" &&
    user.trialEndsAt &&
    Date.now() > new Date(user.trialEndsAt).getTime();

  if (trialExpired && status !== "expired") {
    await User.updateOne(
      { userId, status: { $ne: "expired" } },
      { $set: { status: "expired" } }
    );
    status = "expired";
  }

  return { status, plan: user.plan };
}

export default { resolveAccountStatus, isActiveStatus };
