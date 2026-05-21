// ===========================================
// LemonSqueezy webhook signature verification.
// HMAC-SHA256 over the RAW body using the signing secret
// configured in the LS dashboard. Must run BEFORE any
// JSON parsing — see app.js mount order.
// ===========================================

import crypto from "crypto";

export function verifyLemonSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret || !rawBody) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  let b;
  try {
    b = Buffer.from(String(signatureHeader), "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
