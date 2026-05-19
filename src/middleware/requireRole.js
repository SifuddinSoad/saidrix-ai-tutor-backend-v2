// ===========================================
// requireRole — authorization guard (RBAC)
// Built and ready for the future authorization work.
// NOT wired into any existing route yet. Use after
// `authenticate`:  router.x(path, authenticate,
//   requireRole("admin"), handler)
// ===========================================

import { ForbiddenError, UnauthorizedError } from "../errors/index.js";

export function requireRole(...roles) {
  return function roleGuard(req, _res, next) {
    if (!req.user) {
      return next(new UnauthorizedError("Authentication required"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError("Insufficient role"));
    }
    return next();
  };
}

export default requireRole;
