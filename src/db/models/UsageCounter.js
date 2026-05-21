// ===========================================
// UsageCounter — per-user, per-billing-period usage tally.
// One doc per user per period. Atomic $inc keeps counters
// race-free under concurrent requests. TTL on periodEnd
// auto-purges old docs ~60 days after the period closes.
// Limits live in src/config/billing.config.js TIER_LIMITS.
// ===========================================

import mongoose from "mongoose";

const usageCounterSchema = new mongoose.Schema(
  {
    userId:         { type: String, required: true, index: true },
    periodStart:    { type: Date, required: true },
    periodEnd:      { type: Date, required: true },
    coursesCreated: { type: Number, default: 0 },
    projectReviews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

usageCounterSchema.index({ userId: 1, periodStart: 1 }, { unique: true });

// TTL — Mongo removes the doc when periodEnd + 60 days has elapsed.
usageCounterSchema.index({ periodEnd: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

const UsageCounter = mongoose.model("UsageCounter", usageCounterSchema);
export default UsageCounter;
