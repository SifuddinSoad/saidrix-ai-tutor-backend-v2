// ===========================================
// Tests: auth crypto + token service (DB-free)
// Covers JWT sign/verify roundtrips, token-type
// confusion rejection, code/hash helpers, and the
// bcrypt password hashing mechanism.
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import {
  generateNumericCode,
  sha256,
  randomToken,
  timingSafeEqualHex,
} from "../../src/utils/authCrypto.js";
import {
  signAccessToken,
  verifyAccessToken,
  signSignupToken,
  verifySignupToken,
} from "../../src/services/token.service.js";

const sampleUser = {
  userId: "user-123",
  role: "user",
  plan: "free_trial",
  status: "trialing",
};

// --- authCrypto ----------------------------------------------------------

test("generateNumericCode produces a fixed-length numeric string", () => {
  const code = generateNumericCode(6);
  assert.equal(code.length, 6);
  assert.match(code, /^\d{6}$/);
});

test("sha256 is deterministic and differs per input", () => {
  assert.equal(sha256("abc"), sha256("abc"));
  assert.notEqual(sha256("abc"), sha256("abd"));
});

test("randomToken returns unique high-entropy hex", () => {
  const a = randomToken(32);
  const b = randomToken(32);
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
});

test("timingSafeEqualHex matches equal hex and rejects mismatches", () => {
  const h = sha256("same");
  assert.equal(timingSafeEqualHex(h, h), true);
  assert.equal(timingSafeEqualHex(h, sha256("other")), false);
  assert.equal(timingSafeEqualHex(h, "zz"), false);
  assert.equal(timingSafeEqualHex(h, undefined), false);
});

// --- access token --------------------------------------------------------

test("access token signs and verifies with correct claims", () => {
  const token = signAccessToken(sampleUser);
  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, "user-123");
  assert.equal(payload.role, "user");
  assert.equal(payload.plan, "free_trial");
  assert.equal(payload.typ, "access");
});

test("tampered access token is rejected", () => {
  const token = signAccessToken(sampleUser);
  const broken = token.slice(0, -2) + "xx";
  assert.throws(() => verifyAccessToken(broken));
});

test("a signup token cannot be used as an access token", () => {
  const signup = signSignupToken(sampleUser);
  assert.throws(() => verifyAccessToken(signup));
});

// --- signup token --------------------------------------------------------

test("signup token signs and verifies with signup scope", () => {
  const token = signSignupToken(sampleUser);
  const payload = verifySignupToken(token);
  assert.equal(payload.sub, "user-123");
  assert.equal(payload.scope, "signup");
});

test("an access token cannot be used as a signup token", () => {
  const access = signAccessToken(sampleUser);
  assert.throws(() => verifySignupToken(access));
});

// --- password hashing mechanism -----------------------------------------

test("bcrypt hash verifies the right password and rejects wrong ones", async () => {
  const hash = await bcrypt.hash("Str0ngPass", 10);
  assert.equal(await bcrypt.compare("Str0ngPass", hash), true);
  assert.equal(await bcrypt.compare("wrongpass", hash), false);
  assert.notEqual(hash, "Str0ngPass");
});
