// ===========================================
// Settings Service
// Sensitive flows that re-use the EmailVerification
// model + 6-digit OTP pattern from signup:
//   - change_password  (current pw verified at request,
//     newPassword bcrypt-hashed and stashed in the
//     short-lived code doc; applied at /confirm)
//   - change_email     (password verified, code emailed
//     to the NEW address)
//   - contact          (support ticket persisted + emailed
//     to SUPPORT_INBOX_EMAIL)
// ===========================================

import bcrypt from "bcryptjs";
import User from "../db/models/User.js";
import EmailVerification from "../db/models/EmailVerification.js";
import SupportTicket from "../db/models/SupportTicket.js";
import { authConfig } from "../config/auth.config.js";
import {
  generateNumericCode,
  sha256,
  timingSafeEqualHex,
} from "../utils/authCrypto.js";
import {
  sendCodeEmail,
  sendSupportTicketEmail,
} from "../utils/mailer.js";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from "../errors/index.js";

const { verification, password } = authConfig;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    throw new BadRequestError("A valid email is required");
  }
  return email.trim().toLowerCase();
}

function validateNewPassword(pw) {
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

const EXPOSE_DEV_CODE =
  !authConfig.isProd && process.env.AUTH_EXPOSE_DEV_CODE === "true";

// Invalidate any prior in-flight code for the same user + purpose so the
// latest request is the only one usable. We mark old ones consumed rather
// than delete to keep audit trail intact.
async function supersedePriorCodes(userId, purpose) {
  await EmailVerification.updateMany(
    { userId, purpose, consumedAt: null },
    { $set: { consumedAt: new Date() } }
  );
}

async function fetchActiveCode(userId, purpose) {
  return EmailVerification.findOne({
    userId,
    purpose,
    consumedAt: null,
  }).sort({ createdAt: -1 });
}

function checkAndIncrement(record, code) {
  if (!record || record.expiresAt <= new Date()) {
    throw new BadRequestError("Invalid or expired code");
  }
  if (record.attempts >= verification.maxAttempts) {
    throw new BadRequestError("Too many attempts — request a new code", {
      code: "TOO_MANY_ATTEMPTS",
    });
  }
  const ok = timingSafeEqualHex(sha256(String(code).trim()), record.codeHash);
  if (!ok) {
    record.attempts += 1;
    return record.save().then(() => {
      throw new BadRequestError("Invalid or expired code");
    });
  }
  return Promise.resolve();
}

// ====== change_password ================================================

export async function requestPasswordChange({ userId, currentPassword, newPassword }) {
  validateNewPassword(newPassword);

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  if (!user.passwordHash) {
    throw new UnauthorizedError("Set a password first");
  }
  const ok = await bcrypt.compare(
    typeof currentPassword === "string" ? currentPassword : "",
    user.passwordHash
  );
  if (!ok) throw new UnauthorizedError("Current password is incorrect");

  if (currentPassword === newPassword) {
    throw new BadRequestError("New password must be different from current");
  }

  await supersedePriorCodes(userId, "change_password");

  const code = generateNumericCode(verification.codeLength);
  const newPasswordHash = await bcrypt.hash(newPassword, password.bcryptCost);

  await EmailVerification.create({
    userId,
    email: user.email,
    codeHash: sha256(code),
    purpose: "change_password",
    expiresAt: new Date(Date.now() + verification.codeTtlMs),
    payload: { newPasswordHash },
  });

  await sendCodeEmail({
    to: user.email,
    name: user.name,
    code,
    purpose: "change_password",
  });

  const out = { ok: true, email: user.email };
  if (EXPOSE_DEV_CODE) out.devCode = code;
  return out;
}

export async function confirmPasswordChange({ userId, code }) {
  if (typeof code !== "string" || !/^\d+$/.test(code.trim())) {
    throw new BadRequestError("A valid code is required");
  }

  const record = await fetchActiveCode(userId, "change_password");
  await checkAndIncrement(record, code);

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");

  const newHash = record.payload?.newPasswordHash;
  if (!newHash) {
    throw new BadRequestError("Verification record is corrupt — request a new code");
  }

  user.passwordHash = newHash;
  user.security.passwordChangedAt = new Date();
  await user.save();

  record.consumedAt = new Date();
  record.payload = null;
  await record.save();

  return { ok: true };
}

// ====== change_email ===================================================

export async function requestEmailChange({ userId, newEmail, password: pw }) {
  const cleanEmail = normalizeEmail(newEmail);

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  if (!user.passwordHash) throw new UnauthorizedError("Set a password first");

  const ok = await bcrypt.compare(
    typeof pw === "string" ? pw : "",
    user.passwordHash
  );
  if (!ok) throw new UnauthorizedError("Password is incorrect");

  if (cleanEmail === user.email) {
    throw new BadRequestError("New email is the same as current");
  }

  const taken = await User.findOne({ email: cleanEmail });
  if (taken) throw new ConflictError("Email is already in use");

  await supersedePriorCodes(userId, "change_email");

  const code = generateNumericCode(verification.codeLength);
  await EmailVerification.create({
    userId,
    email: user.email, // who initiated
    target: cleanEmail, // where the code was sent
    codeHash: sha256(code),
    purpose: "change_email",
    expiresAt: new Date(Date.now() + verification.codeTtlMs),
  });

  // Code is sent to the NEW address to prove ownership.
  await sendCodeEmail({
    to: cleanEmail,
    name: user.name,
    code,
    purpose: "change_email",
  });

  const out = { ok: true, newEmail: cleanEmail };
  if (EXPOSE_DEV_CODE) out.devCode = code;
  return out;
}

export async function confirmEmailChange({ userId, code }) {
  if (typeof code !== "string" || !/^\d+$/.test(code.trim())) {
    throw new BadRequestError("A valid code is required");
  }

  const record = await fetchActiveCode(userId, "change_email");
  await checkAndIncrement(record, code);

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");

  const target = record.target;
  if (!target) {
    throw new BadRequestError("Verification record is corrupt — request a new code");
  }

  // Race-safety: bail if someone else took it between request and confirm.
  const taken = await User.findOne({ email: target, userId: { $ne: userId } });
  if (taken) throw new ConflictError("Email is already in use");

  user.email = target;
  user.emailVerified = true;
  await user.save();

  record.consumedAt = new Date();
  await record.save();

  return { ok: true, email: user.email };
}

// ====== contact ========================================================

export async function submitContact({ userId, subject, message }) {
  const subj = (typeof subject === "string" ? subject : "").trim();
  const msg = (typeof message === "string" ? message : "").trim();
  if (!subj || subj.length < 3) {
    throw new BadRequestError("Subject is required");
  }
  if (subj.length > 200) {
    throw new BadRequestError("Subject is too long");
  }
  if (!msg || msg.length < 5) {
    throw new BadRequestError("Message is required");
  }
  if (msg.length > 5000) {
    throw new BadRequestError("Message is too long");
  }

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");

  const ticket = await SupportTicket.create({
    userId,
    email: user.email,
    name: user.name,
    subject: subj,
    message: msg,
  });

  // Best-effort email forwarding — don't fail the API if SMTP is flaky.
  try {
    await sendSupportTicketEmail({
      fromName: user.name,
      fromEmail: user.email,
      subject: subj,
      message: msg,
    });
  } catch {
    /* swallow — the ticket is persisted, admin can poll DB */
  }

  return { ok: true, ticketId: ticket._id.toString() };
}

export default {
  requestPasswordChange,
  confirmPasswordChange,
  requestEmailChange,
  confirmEmailChange,
  submitContact,
};
