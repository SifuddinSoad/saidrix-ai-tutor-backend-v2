// ===========================================
// Auth Service
// All authentication flow logic lives here so route
// handlers stay thin (matching the codebase style).
// Every failure throws a typed AppError subclass that
// the central error middleware formats.
//
// Signup is multi-step:
//   register -> verifyEmail -> setPassword
//     -> selectPlan -> (session issued)
// ===========================================

import bcrypt from "bcryptjs";
import User from "../db/models/User.js";
import EmailVerification from "../db/models/EmailVerification.js";
import RefreshToken from "../db/models/RefreshToken.js";
import { authConfig } from "../config/auth.config.js";
import {
  generateNumericCode,
  sha256,
  timingSafeEqualHex,
} from "../utils/authCrypto.js";
import { sendVerificationEmail } from "../utils/mailer.js";
import {
  signSignupToken,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
} from "./token.service.js";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from "../errors/index.js";

const { verification, password, lockout, trial, plans, paidPlans } = authConfig;

// --- Input validation helpers -------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    throw new BadRequestError("A valid email is required");
  }
  return email.trim().toLowerCase();
}

function validateName(name) {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw new BadRequestError("Name must be at least 2 characters");
  }
  if (name.trim().length > 80) {
    throw new BadRequestError("Name is too long");
  }
  return name.trim();
}

function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length < password.minLength) {
    throw new BadRequestError(
      `Password must be at least ${password.minLength} characters`
    );
  }
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw new BadRequestError(
      "Password must include lowercase, uppercase and a digit"
    );
  }
}

// --- Code issuance (shared by register + resendCode) --------------------

// Strictly dev-only: lets the automated smoke script read the code back.
// Impossible in production (requires NODE_ENV !== production AND an opt-in
// flag that is unset by default).
const EXPOSE_DEV_CODE =
  !authConfig.isProd && process.env.AUTH_EXPOSE_DEV_CODE === "true";

async function issueCode(user) {
  const code = generateNumericCode(verification.codeLength);
  await EmailVerification.create({
    userId: user.userId,
    email: user.email,
    codeHash: sha256(code),
    purpose: "signup",
    expiresAt: new Date(Date.now() + verification.codeTtlMs),
  });
  await sendVerificationEmail(user.email, user.name, code);
  return code;
}

// --- Step 1: register ----------------------------------------------------

export async function register({ name, email }) {
  const cleanName = validateName(name);
  const cleanEmail = normalizeEmail(email);

  const existing = await User.findOne({ email: cleanEmail });

  if (existing && existing.emailVerified) {
    // Already a real account — don't reveal more than necessary.
    throw new ConflictError("Email is already registered");
  }

  let user = existing;
  if (user) {
    // Re-registering an unverified email: reset name + reuse the record.
    user.name = cleanName;
    user.status = "pending_verification";
    await user.save();
  } else {
    user = await User.create({
      name: cleanName,
      email: cleanEmail,
      status: "pending_verification",
    });
  }

  const code = await issueCode(user);
  const out = { userId: user.userId, email: user.email };
  if (EXPOSE_DEV_CODE) out.devCode = code;
  return out;
}

// --- resend code ---------------------------------------------------------

export async function resendCode({ email }) {
  const cleanEmail = normalizeEmail(email);
  const user = await User.findOne({ email: cleanEmail });

  // Don't reveal whether the email exists.
  if (!user || user.emailVerified) {
    return { ok: true };
  }

  const last = await EmailVerification.findOne({
    email: cleanEmail,
    purpose: "signup",
  }).sort({ createdAt: -1 });

  if (
    last &&
    Date.now() - last.createdAt.getTime() < verification.resendCooldownMs
  ) {
    throw new BadRequestError(
      "Please wait before requesting another code",
      { code: "RESEND_COOLDOWN" }
    );
  }

  await issueCode(user);
  return { ok: true };
}

// --- Step 2: verify email ------------------------------------------------

export async function verifyEmail({ email, code }) {
  const cleanEmail = normalizeEmail(email);
  if (typeof code !== "string" || !/^\d+$/.test(code.trim())) {
    throw new BadRequestError("A valid code is required");
  }

  const user = await User.findOne({ email: cleanEmail });
  if (!user) throw new BadRequestError("Invalid or expired code");
  if (user.emailVerified) {
    throw new BadRequestError("Email is already verified");
  }

  const record = await EmailVerification.findOne({
    email: cleanEmail,
    purpose: "signup",
    consumedAt: null,
  }).sort({ createdAt: -1 });

  if (!record || record.expiresAt <= new Date()) {
    throw new BadRequestError("Invalid or expired code");
  }

  if (record.attempts >= verification.maxAttempts) {
    throw new BadRequestError(
      "Too many attempts — request a new code",
      { code: "TOO_MANY_ATTEMPTS" }
    );
  }

  const ok = timingSafeEqualHex(sha256(code.trim()), record.codeHash);
  if (!ok) {
    record.attempts += 1;
    await record.save();
    throw new BadRequestError("Invalid or expired code");
  }

  record.consumedAt = new Date();
  await record.save();

  user.emailVerified = true;
  user.status = "pending_password";
  await user.save();

  return { signupToken: signSignupToken(user), userId: user.userId };
}

// --- Step 3: set password ------------------------------------------------

export async function setPassword({ userId, password: pw }) {
  validatePassword(pw);

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  if (!user.emailVerified) {
    throw new ForbiddenError("Email not verified");
  }
  if (!["pending_password", "pending_plan"].includes(user.status)) {
    throw new ForbiddenError("Password already set");
  }

  user.passwordHash = await bcrypt.hash(pw, password.bcryptCost);
  user.security.passwordChangedAt = new Date();
  user.status = "pending_plan";
  await user.save();

  return { ok: true, userId: user.userId };
}

// --- Step 4: select plan (issues the real session) ----------------------

export async function selectPlan({ userId, plan, ctx }) {
  if (!plans.includes(plan)) {
    throw new BadRequestError(
      `plan must be one of: ${plans.join(", ")}`
    );
  }

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  if (!user.passwordHash) {
    throw new ForbiddenError("Set a password first");
  }
  if (!["pending_plan", "trialing", "active"].includes(user.status)) {
    throw new ForbiddenError("Account is not in plan-selection state");
  }

  user.selectedPlan = plan;
  // Paid plans are only recorded — billing (separate task) activates them.
  // Until then everyone gets effective free-trial access.
  user.plan = "free_trial";
  user.status = "trialing";
  user.trialEndsAt = new Date(
    Date.now() + trial.days * 24 * 60 * 60 * 1000
  );
  await user.save();

  const session = await issueSession(user, ctx);
  return { user: user.toSafeJSON(), ...session };
}

// --- Session issuance ----------------------------------------------------

async function issueSession(user, ctx = {}) {
  const accessToken = signAccessToken(user);
  const refresh = await issueRefreshToken(user, ctx);
  return { accessToken, refreshToken: refresh.raw };
}

// --- Login ---------------------------------------------------------------

export async function login({ email, password: pw, ctx }) {
  const cleanEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  // Generic message everywhere — never reveal which part failed.
  const GENERIC = "Invalid email or password";

  const user = await User.findOne({ email: cleanEmail });
  if (!user || !user.passwordHash) {
    throw new UnauthorizedError(GENERIC);
  }

  if (user.isLocked()) {
    throw new ForbiddenError(
      "Account temporarily locked due to failed attempts. Try again later.",
      { code: "ACCOUNT_LOCKED" }
    );
  }

  const match = await bcrypt.compare(
    typeof pw === "string" ? pw : "",
    user.passwordHash
  );

  if (!match) {
    user.security.failedLoginAttempts += 1;
    if (user.security.failedLoginAttempts >= lockout.maxFailedLogins) {
      user.security.lockUntil = new Date(Date.now() + lockout.lockMs);
      user.security.failedLoginAttempts = 0;
    }
    await user.save();
    throw new UnauthorizedError(GENERIC);
  }

  // Block login until signup is complete; tell the client the next step.
  if (["pending_verification", "pending_password", "pending_plan"].includes(
    user.status
  )) {
    throw new ForbiddenError("Signup is not complete", {
      code: "SIGNUP_INCOMPLETE",
      details: { nextStep: user.status },
    });
  }

  user.security.failedLoginAttempts = 0;
  user.security.lockUntil = null;
  user.security.lastLoginAt = new Date();
  await user.save();

  const session = await issueSession(user, ctx);
  return { user: user.toSafeJSON(), ...session };
}

// --- Refresh -------------------------------------------------------------

export async function refresh({ rawToken, ctx }) {
  const rotated = await rotateRefreshToken(rawToken, ctx);
  const user = await User.findOne({ userId: rotated.userId });
  if (!user) {
    await revokeFamily(rotated.familyId);
    throw new UnauthorizedError("Invalid refresh token");
  }
  const accessToken = signAccessToken(user);
  return { accessToken, refreshToken: rotated.raw, user: user.toSafeJSON() };
}

// --- Logout --------------------------------------------------------------

export async function logout({ rawToken }) {
  if (!rawToken) return { ok: true };
  try {
    const doc = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
    if (doc) await revokeFamily(doc.familyId);
  } catch {
    /* logout is best-effort */
  }
  return { ok: true };
}

// --- Current user --------------------------------------------------------

export async function getCurrentUser(userId) {
  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  return user.toSafeJSON();
}

export default {
  register,
  resendCode,
  verifyEmail,
  setPassword,
  selectPlan,
  login,
  refresh,
  logout,
  getCurrentUser,
};
