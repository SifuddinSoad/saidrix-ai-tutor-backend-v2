// ===========================================
// User Model
// The identity record. `userId` reuses the exact
// UUID-string pattern every other model keys on, so
// future authorization is just reading req.user.userId
// with zero migration.
//
// status lifecycle (signup is multi-step):
//   pending_verification -> pending_password
//     -> pending_plan -> pending_payment -> trialing -> active
//   (also: expired | suspended)
//
// `pending_payment`: plan chosen at signup but the user has not
// yet completed the LemonSqueezy hosted checkout (no card on file).
// They have a session but `requireActive` denies content until the
// subscription_created webhook flips them to `trialing`/`active`.
// ===========================================

import mongoose from "mongoose";
import { randomUUID } from "crypto";

const PLANS = ["free_trial", "starter", "plus", "max"];
const STATUSES = [
  "pending_verification",
  "pending_password",
  "pending_plan",
  "pending_payment",
  "trialing",
  "active",
  "expired",
  "suspended",
];

const BILLING_CYCLES = ["monthly", "annual"];

const userSchema = new mongoose.Schema(
  {
    // Stable identity — matches the userId string used across all models
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => randomUUID(),
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    // bcrypt hash — null until the user sets a password (signup step 3)
    passwordHash: {
      type: String,
      default: null,
    },

    // Authorization-ready (not enforced on existing routes yet)
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },

    // Effective access tier. Today only free_trial grants access; paid
    // tiers are recorded in selectedPlan and activated by billing later.
    plan: {
      type: String,
      enum: PLANS,
      default: "free_trial",
      index: true,
    },

    // What the user chose at signup (may be a paid plan with no billing yet)
    selectedPlan: {
      type: String,
      enum: PLANS,
      default: null,
    },

    // Billing cycle chosen at signup — remembered across the LemonSqueezy
    // redirect and reused if the user resumes an abandoned checkout.
    selectedCycle: {
      type: String,
      enum: BILLING_CYCLES,
      default: "monthly",
    },

    status: {
      type: String,
      enum: STATUSES,
      default: "pending_verification",
      index: true,
    },

    trialEndsAt: {
      type: Date,
      default: null,
    },

    // Brute-force / lockout bookkeeping
    security: {
      failedLoginAttempts: { type: Number, default: 0 },
      lockUntil: { type: Date, default: null },
      lastLoginAt: { type: Date, default: null },
      passwordChangedAt: { type: Date, default: null },
    },

    // Gamification — driven by lecture/project completions.
    // lastActivityDate is the date (UTC midnight) of the most recent
    // completion; used to advance/reset the day streak.
    stats: {
      xp: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      longestStreak: { type: Number, default: 0 },
      lastActivityDate: { type: Date, default: null },
    },

    // Personal profile (user-editable via /api/profile/overview).
    // All optional — every existing user keeps working with empty defaults.
    profile: {
      phone:     { type: String, default: "", trim: true, maxlength: 40 },
      bio:       { type: String, default: "", trim: true, maxlength: 500 },
      avatarUrl: { type: String, default: "", trim: true, maxlength: 500 },
    },

    // Career info (user-editable via /api/profile/career).
    career: {
      currentRole:     { type: String, default: "", trim: true, maxlength: 120 },
      experienceLevel: { type: String, default: "", trim: true, maxlength: 60 },
      industry:        { type: String, default: "", trim: true, maxlength: 120 },
      targetRole:      { type: String, default: "", trim: true, maxlength: 120 },
      careerGoal:      { type: String, default: "", trim: true, maxlength: 1000 },
      skills:          { type: [String], default: [] },
    },

    // LemonSqueezy subscription state. Populated/updated by webhook handlers
    // in src/services/billing.service.js. `user.plan` (above) is the
    // access-tier source of truth; this sub-doc carries everything billing
    // needs to manage the customer (portal URL, card display, renewal date).
    subscription: {
      lemonCustomerId:        { type: String, default: null },
      lemonSubscriptionId:    { type: String, default: null },
      lemonVariantId:         { type: String, default: null },
      status: {
        type: String,
        enum: ["active", "on_trial", "past_due", "cancelled", "expired", "unpaid", "paused", null],
        default: null,
      },
      billingCycle:           { type: String, enum: ["monthly", "annual", null], default: null },
      renewsAt:               { type: Date, default: null },
      endsAt:                 { type: Date, default: null }, // set on cancellation — access until this date
      cardBrand:              { type: String, default: "" },
      cardLastFour:           { type: String, default: "" },
      customerPortalUrl:      { type: String, default: "" },
      updatePaymentMethodUrl: { type: String, default: "" },
    },

    // Social links (user-editable via /api/profile/social).
    social: {
      github:    { type: String, default: "", trim: true, maxlength: 200 },
      linkedin:  { type: String, default: "", trim: true, maxlength: 200 },
      twitter:   { type: String, default: "", trim: true, maxlength: 200 },
      portfolio: { type: String, default: "", trim: true, maxlength: 200 },
      other:     { type: String, default: "", trim: true, maxlength: 200 },
    },
  },
  {
    timestamps: true,
  }
);

// --- Instance helpers ---

userSchema.methods.isLocked = function isLocked() {
  return !!(this.security?.lockUntil && this.security.lockUntil > new Date());
};

// Never leak passwordHash or internal security counters to clients
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    userId: this.userId,
    name: this.name,
    email: this.email,
    emailVerified: this.emailVerified,
    role: this.role,
    plan: this.plan,
    selectedPlan: this.selectedPlan,
    selectedCycle: this.selectedCycle,
    status: this.status,
    trialEndsAt: this.trialEndsAt,
    stats: this.stats,
    profile: this.profile || {},
    career: this.career || { skills: [] },
    social: this.social || {},
    subscription: this.subscription || {},
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

userSchema.statics.PLANS = PLANS;
userSchema.statics.STATUSES = STATUSES;

const User = mongoose.model("User", userSchema);
export default User;
