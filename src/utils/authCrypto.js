// ===========================================
// Auth crypto helpers
// Small, dependency-free primitives shared by the
// auth service: numeric verification codes, SHA-256
// hashing (for codes + refresh tokens — never store
// these raw), opaque refresh tokens, and a
// timing-safe hex comparison.
// ===========================================

import crypto from "crypto";

// --- Random numeric code (zero-padded, fixed length) ---
export function generateNumericCode(length = 6) {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, "0");
}

// --- SHA-256 hex digest (codes + refresh tokens are stored hashed) ---
export function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

// --- Opaque high-entropy token (raw refresh token value) ---
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

// --- Constant-time comparison of two hex strings ---
// Returns false (no throw) on any length / format mismatch so callers
// can treat it as a plain boolean check without leaking timing.
export function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export default {
  generateNumericCode,
  sha256,
  randomToken,
  timingSafeEqualHex,
};
