// ===========================================
// checkUsageLimit(field) — express middleware factory.
//
// Behavior (in order):
//   1. trial expired (free_trial + trialEndsAt < now) -> 402 requiresUpgrade
//   2. still in trial -> allow, do not count
//   3. paid plan: load (or create) the user's current UsageCounter,
//      compare against TIER_LIMITS[plan][field]
//        - limit reached -> 403 with {limit, used, plan, field}
//        - else atomic $inc on the field, then next()
//
// Atomic $inc + the unique {userId, periodStart} index makes concurrent
// requests safe — no read-then-write race.
// ===========================================

import User from "../db/models/User.js";
import UsageCounter from "../db/models/UsageCounter.js";
import { TIER_LIMITS, PAID_PLANS } from "../config/billing.config.js";
import {
  ForbiddenError,
  PaymentRequiredError,
  NotFoundError,
} from "../errors/index.js";
import { currentCounter } from "../services/billing.service.js";

const ALLOWED_FIELDS = new Set(["coursesCreated", "projectReviews"]);

export function checkUsageLimit(field) {
  if (!ALLOWED_FIELDS.has(field)) {
    throw new Error(`checkUsageLimit: invalid field "${field}"`);
  }
  return async function checkUsageLimitMw(req, _res, next) {
    try {
      const user = await User.findOne({ userId: req.user.userId });
      if (!user) throw new NotFoundError("User not found");

      // Trial path
      if (user.plan === "free_trial") {
        const expired = user.trialEndsAt && Date.now() > new Date(user.trialEndsAt).getTime();
        if (expired) {
          throw new PaymentRequiredError("Your free trial has ended.", {
            details: { requiresUpgrade: true, reason: "trial_expired" },
          });
        }
        return next();
      }

      // Paid path
      if (!PAID_PLANS.includes(user.plan)) {
        throw new PaymentRequiredError("Active subscription required.", {
          details: { requiresUpgrade: true, reason: "no_subscription" },
        });
      }
      const limit = TIER_LIMITS[user.plan][field];
      if (limit === Infinity) return next();

      const counter = await currentCounter(user);
      if (!counter) {
        // No counter (subscription state inconsistent) — fail safe.
        throw new PaymentRequiredError("Subscription period not initialised.", {
          details: { requiresUpgrade: true, reason: "no_period" },
        });
      }
      const used = counter[field] || 0;
      if (used >= limit) {
        throw new ForbiddenError(`Plan limit reached (${limit}/${field}).`, {
          details: { limit, used, plan: user.plan, field, requiresUpgrade: true },
        });
      }

      // Atomic increment — racing requests can't both pass the check above.
      const updated = await UsageCounter.findOneAndUpdate(
        {
          _id: counter._id,
          [field]: { $lt: limit },
        },
        { $inc: { [field]: 1 } },
        { new: true }
      );
      if (!updated) {
        throw new ForbiddenError(`Plan limit reached (${limit}/${field}).`, {
          details: { limit, used: limit, plan: user.plan, field, requiresUpgrade: true },
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export default checkUsageLimit;
