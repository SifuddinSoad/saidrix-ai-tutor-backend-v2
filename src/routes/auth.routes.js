// ===========================================
// Auth Routes  (mounted at /api/auth)
// Thin handlers — all logic is in auth.service.
//
// Signup flow:
//   POST /register      {name,email}        -> emails a code
//   POST /verify-email  {email,code}        -> { signupToken }
//   POST /set-password  (Bearer signupToken){password}
//   POST /select-plan   (Bearer signupToken){plan,cycle}
//                       -> session (pending_payment) + checkoutUrl
// Session:
//   POST /login   POST /refresh   POST /logout
//   POST /resend-code   GET /me
// ===========================================

import { Router } from "express";
import {
  asyncHandler,
  UnauthorizedError,
} from "../errors/index.js";
import * as authService from "../services/auth.service.js";
import { verifySignupToken } from "../services/token.service.js";
import { authenticate } from "../middleware/authenticate.js";
import {
  setCsrfCookie,
  clearCsrfCookie,
  verifyCsrf,
} from "../middleware/csrf.js";
import {
  registerLimiter,
  loginLimiter,
  verifyLimiter,
  resendLimiter,
} from "../middleware/rateLimiters.js";
import { authConfig } from "../config/auth.config.js";

const router = Router();
const { cookie, refresh } = authConfig;

// --- Cookie helpers ------------------------------------------------------

function setRefreshCookie(res, token) {
  res.cookie(cookie.name, token, {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    domain: cookie.domain,
    maxAge: refresh.ttlDays * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(cookie.name, {
    path: cookie.path,
    domain: cookie.domain,
  });
}

function reqCtx(req) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
  };
}

// --- Signup-token guard (steps 3 & 4) ------------------------------------

function authenticateSignup(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return next(new UnauthorizedError("Missing signup token"));
  }
  try {
    const payload = verifySignupToken(token);
    req.signupUserId = payload.sub;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Issue session cookies + body for selectPlan/login/refresh results.
// `extra` merges additional fields (e.g. checkoutUrl) into the JSON body.
function sendSession(res, result, status = 200, extra = {}) {
  setRefreshCookie(res, result.refreshToken);
  setCsrfCookie(res);
  return res.status(status).json({
    user: result.user,
    accessToken: result.accessToken,
    ...extra,
  });
}

// First configured frontend origin (FRONTEND_ORIGIN is comma-separated),
// used to build the LemonSqueezy post-checkout redirect URL.
function frontendOrigin() {
  const first = (process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return first || "http://localhost:5173";
}

// --- Step 1: register ----------------------------------------------------

router.post(
  "/register",
  registerLimiter,
  asyncHandler(async (req, res) => {
    const { name, email } = req.body || {};
    const result = await authService.register({ name, email });
    const body = {
      message: "Verification code sent",
      userId: result.userId,
      email: result.email,
    };
    if (result.devCode) body.devCode = result.devCode; // dev-only, gated
    res.status(201).json(body);
  })
);

// --- Step 2: verify email ------------------------------------------------

router.post(
  "/verify-email",
  verifyLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = req.body || {};
    const result = await authService.verifyEmail({ email, code });
    res.json({
      message: "Email verified",
      signupToken: result.signupToken,
      userId: result.userId,
    });
  })
);

// --- resend code ---------------------------------------------------------

router.post(
  "/resend-code",
  resendLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    await authService.resendCode({ email });
    res.json({ message: "If the email is pending verification, a code was sent" });
  })
);

// --- Step 3: set password ------------------------------------------------

router.post(
  "/set-password",
  authenticateSignup,
  asyncHandler(async (req, res) => {
    const { password } = req.body || {};
    const result = await authService.setPassword({
      userId: req.signupUserId,
      password,
    });
    res.json({ message: "Password set", userId: result.userId });
  })
);

// --- Step 4: select plan (issues session) --------------------------------

router.post(
  "/select-plan",
  authenticateSignup,
  asyncHandler(async (req, res) => {
    const { plan, cycle } = req.body || {};
    const result = await authService.selectPlan({
      userId: req.signupUserId,
      plan,
      cycle,
      redirectUrl: `${frontendOrigin()}/signup/success`,
      ctx: reqCtx(req),
    });
    sendSession(res, result, 200, { checkoutUrl: result.checkoutUrl });
  })
);

// --- Login ---------------------------------------------------------------

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const result = await authService.login({
      email,
      password,
      ctx: reqCtx(req),
    });
    sendSession(res, result, 200);
  })
);

// --- Refresh (cookie + CSRF) --------------------------------------------

router.post(
  "/refresh",
  verifyCsrf,
  asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[cookie.name];
    const result = await authService.refresh({
      rawToken,
      ctx: reqCtx(req),
    });
    sendSession(res, result, 200);
  })
);

// --- Logout (cookie + CSRF) ----------------------------------------------

router.post(
  "/logout",
  verifyCsrf,
  asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[cookie.name];
    await authService.logout({ rawToken });
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    res.json({ message: "Logged out" });
  })
);

// --- Current user (dashboard gate) ---------------------------------------

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await authService.getCurrentUser(req.user.userId);
    res.json({ user });
  })
);

export default router;
