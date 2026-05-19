// ===========================================
// authenticate — Bearer access-token guard
// Reads `Authorization: Bearer <token>`, verifies the
// access JWT and attaches a minimal identity to
// req.user. Use on any route that needs a logged-in
// user. (Existing agent routes are intentionally NOT
// wired to this yet — scope: auth subsystem only.)
// ===========================================

import { verifyAccessToken } from "../services/token.service.js";
import { UnauthorizedError } from "../errors/index.js";

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new UnauthorizedError("Missing or malformed Authorization header"));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      userId: payload.sub,
      role: payload.role,
      plan: payload.plan,
      status: payload.status,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

export default authenticate;
