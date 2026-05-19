// ===========================================
// User Model
// The identity record. `userId` reuses the exact
// UUID-string pattern every other model keys on, so
// future authorization is just reading req.user.userId
// with zero migration.
//
// status lifecycle (signup is multi-step):
//   pending_verification -> pending_password
//     -> pending_plan -> trialing -> active
//   (also: expired | suspended)
//
// Trial expiry / plan enforcement is intentionally NOT
// enforced here — modeled only (trialEndsAt,
// selectedPlan) and left to the later billing task.
// ===========================================

import mongoose from "mongoose";
import { randomUUID } from "crypto";

const PLANS = ["free_trial", "starter", "plus", "max"];
const STATUSES = [
  "pending_verification",
  "pending_password",
  "pending_plan",
  "trialing",
  "active",
  "expired",
  "suspended",
];

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
    status: this.status,
    trialEndsAt: this.trialEndsAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

userSchema.statics.PLANS = PLANS;
userSchema.statics.STATUSES = STATUSES;

const User = mongoose.model("User", userSchema);
export default User;
