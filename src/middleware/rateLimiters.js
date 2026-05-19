// ===========================================
// Rate limiters (brute-force protection)
// express-rate-limit backed by a Mongo store so
// limits survive restarts and work across instances.
// If the Mongo store can't initialize we fall back to
// the in-memory store rather than failing to boot.
//
// Per-IP limits here; per-ACCOUNT lockout is handled
// separately in auth.service (login).
// ===========================================

import rateLimit from "express-rate-limit";
import MongoStore from "rate-limit-mongo";
import logger from "../utils/logger.js";

const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/saidrix-ai-tutor";

function makeStore(prefix, windowMs) {
  try {
    return new MongoStore({
      uri: MONGO_URI,
      collectionName: `rateLimit_${prefix}`,
      expireTimeMs: windowMs,
      errorHandler: (err) =>
        logger.error(`[rateLimit:${prefix}] store error: ${err.message}`),
    });
  } catch (err) {
    logger.warn(
      `[rateLimit:${prefix}] Mongo store unavailable, using memory store: ${err.message}`
    );
    return undefined; // express-rate-limit defaults to memory store
  }
}

function build({ prefix, windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeStore(prefix, windowMs),
    handler: (_req, res) => {
      res.status(429).json({ error: message, code: "RATE_LIMITED" });
    },
  });
}

const FIFTEEN_MIN = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export const registerLimiter = build({
  prefix: "register",
  windowMs: HOUR,
  limit: 10,
  message: "Too many sign-up attempts. Try again later.",
});

export const loginLimiter = build({
  prefix: "login",
  windowMs: FIFTEEN_MIN,
  limit: 10,
  message: "Too many login attempts. Try again later.",
});

export const verifyLimiter = build({
  prefix: "verify",
  windowMs: FIFTEEN_MIN,
  limit: 15,
  message: "Too many verification attempts. Try again later.",
});

export const resendLimiter = build({
  prefix: "resend",
  windowMs: HOUR,
  limit: 6,
  message: "Too many code requests. Try again later.",
});

export default {
  registerLimiter,
  loginLimiter,
  verifyLimiter,
  resendLimiter,
};
