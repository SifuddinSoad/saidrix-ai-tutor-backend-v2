// ===========================================
// Auth Configuration
// Centralizes every auth constant / TTL / policy and
// validates secrets at boot. In production a missing
// or weak JWT secret is fatal (fail fast). In dev we
// fall back to generated ephemeral secrets + warn so
// the flow still works locally without setup.
// ===========================================

import crypto from "crypto";
import logger from "../utils/logger.js";

const IS_PROD = process.env.NODE_ENV === "production";
const MIN_SECRET_LEN = 32;

// --- Secret resolution ---------------------------------------------------

function resolveSecret(name) {
  const val = process.env[name];

  if (val && val.length >= MIN_SECRET_LEN) return val;

  if (IS_PROD) {
    throw new Error(
      `[auth.config] ${name} is required and must be >= ${MIN_SECRET_LEN} chars in production`,
    );
  }

  // Dev fallback — ephemeral, regenerated each boot (tokens won't survive
  // a restart; that is acceptable and intentional for local dev).
  logger.warn(
    `[auth.config] ${name} missing/weak — using an ephemeral dev secret. ` +
      `Set a strong ${name} (>= ${MIN_SECRET_LEN} chars) for production.`,
  );
  return crypto.randomBytes(48).toString("hex");
}

// --- Numeric env helpers -------------------------------------------------

function num(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

// --- Exported config -----------------------------------------------------

export const authConfig = {
  isProd: IS_PROD,

  jwt: {
    accessSecret: resolveSecret("JWT_ACCESS_SECRET"),
    refreshSecret: resolveSecret("JWT_REFRESH_SECRET"),
    signupSecret: resolveSecret("JWT_SIGNUP_SECRET"),
    accessTtl: process.env.ACCESS_TOKEN_TTL || "15m",
    signupTtl: process.env.SIGNUP_TOKEN_TTL || "15m",
    issuer: "saidrix-auth",
  },

  refresh: {
    ttlDays: num("REFRESH_TOKEN_TTL_DAYS", 30),
  },

  verification: {
    codeTtlMs: num("VERIFICATION_CODE_TTL_MIN", 10) * 60 * 1000,
    maxAttempts: 5,
    resendCooldownMs: 60 * 1000,
    codeLength: 6,
  },

  password: {
    bcryptCost: num("BCRYPT_COST", 12),
    minLength: 8,
  },

  lockout: {
    maxFailedLogins: 5,
    lockMs: 15 * 60 * 1000,
  },

  trial: {
    days: num("TRIAL_DAYS", 3),
  },

  cookie: {
    name: "refreshToken",
    csrfName: "csrfToken",
    path: "/api/auth",
    domain: process.env.COOKIE_DOMAIN || undefined,
    secure: IS_PROD,
    sameSite: "lax",
  },

  // The 4 user tiers. `free_trial` is the only one that grants access today;
  // the paid tiers are recorded as `selectedPlan` and activated by the
  // (separate, later) billing task.
  plans: ["free_trial", "starter", "plus", "max"],
  paidPlans: ["starter", "plus", "max"],

  mail: {
    from: process.env.MAIL_FROM || "Saidrix <no-reply@saidrix.local>",
    appUrl: process.env.APP_URL || "http://localhost:3000",
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: num("SMTP_PORT", 587),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
  },
};

export default authConfig;
