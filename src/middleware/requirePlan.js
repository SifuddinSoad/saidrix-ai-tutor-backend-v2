// ===========================================
// requirePlan / requireActive — billing-readiness guards
// Built for the future billing task. NOT wired into
// existing routes. `requireActive` also blocks
// expired/suspended accounts — once trial-expiry
// enforcement lands, flipping a user to `expired`
// will gate them here automatically.
// ===========================================

import { ForbiddenError, UnauthorizedError } from "../errors/index.js";
import { resolveAccountStatus, isActiveStatus } from "../utils/accountStatus.js";

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

// Authoritative gate: re-reads the live User record (and lazily expires a
// lapsed trial) instead of trusting the JWT `status` claim, which can be a
// stale snapshot. Without this, a trial that ends mid-token — or a refresh
// re-issuing the old status — would keep granting access.
export async function requireActive(req, _res, next) {
  try {
    if (!req.user?.userId) {
      return next(new UnauthorizedError("Authentication required"));
    }
    const acct = await resolveAccountStatus(req.user.userId);
    if (!acct) {
      return next(new UnauthorizedError("Authentication required"));
    }
    if (!isActiveStatus(acct.status)) {
      return next(
        new ForbiddenError("Account is not active", {
          code: "ACCOUNT_INACTIVE",
          details: { status: acct.status },
        })
      );
    }
    // Keep req.user fresh for any downstream handler/gate.
    req.user.status = acct.status;
    req.user.plan = acct.plan;
    return next();
  } catch (err) {
    return next(err);
  }
}

export default requirePlan;
