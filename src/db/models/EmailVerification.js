// ===========================================
// EmailVerification Model
// One-time email codes. The code itself is never
// stored — only its SHA-256 hash. Documents expire
// automatically via a Mongo TTL index on expiresAt
// (expireAfterSeconds: 0), so stale/unused codes
// self-clean with no cron.
//
// `purpose` reserves "password_reset" for a future
// task; only "signup" is issued today.
// ===========================================

import mongoose from "mongoose";

const emailVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    // SHA-256 of the numeric code (never the raw code)
    codeHash: {
      type: String,
      required: true,
    },

    purpose: {
      type: String,
      enum: ["signup", "password_reset"],
      default: "signup",
    },

    attempts: {
      type: Number,
      default: 0,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    consumedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// TTL: Mongo deletes the doc once expiresAt is reached
emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Lookup the active code for an email + purpose, newest first
emailVerificationSchema.index({ email: 1, purpose: 1, createdAt: -1 });

const EmailVerification = mongoose.model(
  "EmailVerification",
  emailVerificationSchema
);
export default EmailVerification;
