// ===========================================
// requirePlan / requireActive — billing-readiness guards
// Built for the future billing task. NOT wired into
// existing routes. `requireActive` also blocks
// expired/suspended accounts — once trial-expiry
// enforcement lands, flipping a user to `expired`
// will gate them here automatically.
// ===========================================

import { ForbiddenError, UnauthorizedError } from "../errors/index.js";

export function requirePlan(...allowed) {
  return function planGuard(req, _res, next) {
    if (!req.user) {
      return next(new UnauthorizedError("Authentication required"));
    }
    if (!allowed.includes(req.user.plan)) {
      return next(
        new ForbiddenError("Your plan does not include this feature", {
          code: "PLAN_REQUIRED",
          details: { allowed },
        })
      );
    }
    return next();
  };
}

export function requireActive(req, _res, next) {
  if (!req.user) {
    return next(new UnauthorizedError("Authentication required"));
  }
  if (!["trialing", "active"].includes(req.user.status)) {
    return next(
      new ForbiddenError("Account is not active", {
        code: "ACCOUNT_INACTIVE",
        details: { status: req.user.status },
      })
    );
  }
  return next();
}

export default requirePlan;
