// ===========================================
// Token Service
// Owns every JWT and the refresh-token lifecycle.
//
// - Access token : short-lived JWT, sent in the JSON
//   body, carried by the client as a Bearer header.
// - Signup token : short-lived scoped JWT that
//   authorizes the set-password / select-plan steps.
// - Refresh token: opaque random value, stored only
//   as a SHA-256 hash, delivered via httpOnly cookie,
//   rotated on every use with reuse detection.
// ===========================================

import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import RefreshToken from "../db/models/RefreshToken.js";
import { authConfig } from "../config/auth.config.js";
import { sha256, randomToken } from "../utils/authCrypto.js";
import { UnauthorizedError } from "../errors/index.js";
import logger from "../utils/logger.js";

const { jwt: jwtCfg, refresh: refreshCfg } = authConfig;

// --- Access token --------------------------------------------------------

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.userId,
      role: user.role,
      plan: user.plan,
      status: user.status,
      typ: "access",
    },
    jwtCfg.accessSecret,
    { expiresIn: jwtCfg.accessTtl, issuer: jwtCfg.issuer }
  );
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, jwtCfg.accessSecret, {
      issuer: jwtCfg.issuer,
    });
    if (payload.typ !== "access") throw new Error("wrong token type");
    return payload;
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}

// --- Signup-step token (authorizes steps 3 & 4) --------------------------

export function signSignupToken(user) {
  return jwt.sign(
    { sub: user.userId, scope: "signup", typ: "signup" },
    jwtCfg.signupSecret,
    { expiresIn: jwtCfg.signupTtl, issuer: jwtCfg.issuer }
  );
}

export function verifySignupToken(token) {
  try {
    const payload = jwt.verify(token, jwtCfg.signupSecret, {
      issuer: jwtCfg.issuer,
    });
    if (payload.typ !== "signup" || payload.scope !== "signup") {
      throw new Error("wrong token type");
    }
    return payload;
  } catch {
    throw new UnauthorizedError("Invalid or expired signup token");
  }
}

// --- Refresh token -------------------------------------------------------

function refreshExpiry() {
  return new Date(Date.now() + refreshCfg.ttlDays * 24 * 60 * 60 * 1000);
}

// Issue a brand-new refresh token (new family = new login session)
export async function issueRefreshToken(user, ctx = {}) {
  const raw = randomToken(32);
  const familyId = ctx.familyId || randomUUID();

  const doc = await RefreshToken.create({
    tokenId: randomUUID(),
    userId: user.userId,
    familyId,
    tokenHash: sha256(raw),
    userAgent: ctx.userAgent || "",
    ip: ctx.ip || "",
    expiresAt: refreshExpiry(),
  });

  return { raw, tokenId: doc.tokenId, familyId };
}

export async function revokeToken(tokenId) {
  await RefreshToken.updateOne(
    { tokenId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function revokeFamily(familyId) {
  await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

// Rotate: validate the presented token, issue its successor, revoke it.
// Reuse of an already-rotated/revoked token => theft => revoke whole family.
export async function rotateRefreshToken(rawToken, ctx = {}) {
  if (!rawToken) throw new UnauthorizedError("Missing refresh token");

  const doc = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });

  if (!doc) throw new UnauthorizedError("Invalid refresh token");

  if (doc.revokedAt || doc.replacedByTokenId) {
    // A token that was already rotated is being replayed — compromise signal.
    logger.warn(
      `[token] refresh reuse detected for user=${doc.userId} family=${doc.familyId} — revoking family`
    );
    await revokeFamily(doc.familyId);
    throw new UnauthorizedError("Refresh token reuse detected");
  }

  if (doc.expiresAt <= new Date()) {
    throw new UnauthorizedError("Refresh token expired");
  }

  // Issue successor in the same family, then revoke the presented token.
  const next = await issueRefreshToken(
    { userId: doc.userId },
    { ...ctx, familyId: doc.familyId }
  );

  doc.revokedAt = new Date();
  doc.replacedByTokenId = next.tokenId;
  await doc.save();

  return { userId: doc.userId, ...next };
}

export default {
  signAccessToken,
  verifyAccessToken,
  signSignupToken,
  verifySignupToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeToken,
  revokeFamily,
};
