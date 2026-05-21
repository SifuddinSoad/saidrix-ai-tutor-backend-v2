// ===========================================
// Billing config — tier limits + LemonSqueezy variant map.
// TIER_LIMITS is consulted by checkUsageLimit middleware.
// VARIANTS is the source of truth for {plan,cycle} -> LS variant id.
// ===========================================

export const PAID_PLANS = ["starter", "plus", "max"];
export const BILLING_CYCLES = ["monthly", "annual"];

export const TIER_LIMITS = {
  starter: { coursesCreated: 3,        projectReviews: 10 },
  plus:    { coursesCreated: 10,       projectReviews: 40 },
  max:     { coursesCreated: Infinity, projectReviews: Infinity },
};

// LemonSqueezy variant IDs come from env. Strings (LS returns them as
// numeric strings in API payloads — keep as String for safe equality).
export const VARIANTS = {
  starter: {
    monthly: process.env.LEMON_VARIANT_STARTER_MONTHLY || "",
    annual:  process.env.LEMON_VARIANT_STARTER_ANNUAL  || "",
  },
  plus: {
    monthly: process.env.LEMON_VARIANT_PLUS_MONTHLY || "",
    annual:  process.env.LEMON_VARIANT_PLUS_ANNUAL  || "",
  },
  max: {
    monthly: process.env.LEMON_VARIANT_MAX_MONTHLY || "",
    annual:  process.env.LEMON_VARIANT_MAX_ANNUAL  || "",
  },
};

// Reverse lookup — given a LemonSqueezy variant id (from a webhook payload),
// return { plan, cycle } or null if unknown.
export function planFromVariant(variantId) {
  if (!variantId) return null;
  const target = String(variantId);
  for (const plan of PAID_PLANS) {
    for (const cycle of BILLING_CYCLES) {
      if (VARIANTS[plan][cycle] && String(VARIANTS[plan][cycle]) === target) {
        return { plan, cycle };
      }
    }
  }
  return null;
}

export function getVariantId(plan, cycle) {
  return VARIANTS[plan]?.[cycle] || null;
}
