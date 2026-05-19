// ===========================================
// RefreshToken Model
// One document per issued refresh token. The raw
// token is never stored — only its SHA-256 hash.
//
// Rotation + reuse detection works via familyId:
// every refresh issues a new token in the same
// family and revokes the old one. If an already-
// rotated (revoked) token is presented again it is
// a theft signal — the WHOLE family is revoked.
//
// Expired docs self-clean via a TTL index.
// ===========================================

import mongoose from "mongoose";
import { randomUUID } from "crypto";

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => randomUUID(),
    },

    userId: {
      type: String,
      required: true,
      index: true,
    },

    // Rotation lineage — shared across all tokens derived from one login
    familyId: {
      type: String,
      required: true,
      index: true,
    },

    // SHA-256 of the raw refresh token
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },

    userAgent: {
      type: String,
      default: "",
    },

    ip: {
      type: String,
      default: "",
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    replacedByTokenId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// TTL cleanup of expired tokens
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
export default RefreshToken;
