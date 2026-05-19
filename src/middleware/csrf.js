// ===========================================
// CSRF — double-submit cookie
// The refresh/logout endpoints authenticate via the
// httpOnly refresh cookie, so they need CSRF defence
// (SameSite=strict already mitigates; this is
// defence-in-depth).
//
// On session issue we set a NON-httpOnly csrf cookie.
// The client reads it and echoes it back in the
// `x-csrf-token` header. The server requires both to
// be present and equal (constant-time compare).
// ===========================================

import { randomToken, timingSafeEqualHex } from "../utils/authCrypto.js";
import { authConfig } from "../config/auth.config.js";
import { ForbiddenError } from "../errors/index.js";

const { cookie } = authConfig;

// The CSRF cookie is intentionally readable by JS and scoped to "/" (not the
// refresh cookie's /api/auth path) so the SPA — which runs at "/" — can read
// it and echo it back in the x-csrf-token header (double-submit). It carries
// no secret on its own; security comes from it matching the header.
const CSRF_PATH = "/";

export function setCsrfCookie(res) {
  const value = randomToken(24);
  res.cookie(cookie.csrfName, value, {
    httpOnly: false, // client JS must read it to echo in the header
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: CSRF_PATH,
    domain: cookie.domain,
    maxAge: authConfig.refresh.ttlDays * 24 * 60 * 60 * 1000,
  });
  return value;
}

export function clearCsrfCookie(res) {
  res.clearCookie(cookie.csrfName, {
    path: CSRF_PATH,
    domain: cookie.domain,
  });
}

// Guard for cookie-authenticated state-changing endpoints
export function verifyCsrf(req, _res, next) {
  const cookieToken = req.cookies?.[cookie.csrfName];
  const headerToken = req.get("x-csrf-token");

  if (
    !cookieToken ||
    !headerToken ||
    !timingSafeEqualHex(cookieToken, headerToken)
  ) {
    return next(new ForbiddenError("Invalid CSRF token", { code: "CSRF" }));
  }
  return next();
}

export default verifyCsrf;
