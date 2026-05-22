// ===========================================
// Billing service — checkout creation, billing state read,
// and the LemonSqueezy webhook event handler. All persistence
// of subscription state on User happens here.
// ===========================================

import User from "../db/models/User.js";
import UsageCounter from "../db/models/UsageCounter.js";
import * as ls from "./lemonsqueezy.client.js";
import {
  BILLING_CYCLES,
  PAID_PLANS,
  TIER_LIMITS,
  getVariantId,
  planFromVariant,
} from "../config/billing.config.js";
import {
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import logger from "../utils/logger.js";

// ---- Checkout ----

export async function startCheckout({ userId, plan, cycle, redirectUrl }) {
  if (!PAID_PLANS.includes(plan)) throw new BadRequestError(`Unknown plan: ${plan}`);
  if (!BILLING_CYCLES.includes(cycle)) throw new BadRequestError(`Unknown billing cycle: ${cycle}`);
  const variantId = getVariantId(plan, cycle);
  if (!variantId) throw new BadRequestError(`Variant for ${plan}/${cycle} not configured.`);

  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");

  const url = await ls.createCheckoutUrl({
    variantId,
    userId: user.userId,
    email: user.email,
    name: user.name,
    redirectUrl,
  });
  return { url };
}

// ---- Billing state (frontend GET /api/billing/state) ----

export async function getBillingState(userId) {
  const user = await User.findOne({ userId }).lean();
  if (!user) throw new NotFoundError("User not found");

  const counter = await currentCounter(user);
  const limits =
    PAID_PLANS.includes(user.plan) ? TIER_LIMITS[user.plan] : null;

  return {
    plan: user.plan,
    selectedPlan: user.selectedPlan,
    status: user.status,
    trialEndsAt: user.trialEndsAt,
    subscription: user.subscription || {},
    usage: counter
      ? {
          coursesCreated: counter.coursesCreated || 0,
          projectReviews: counter.projectReviews || 0,
          periodStart: counter.periodStart,
          periodEnd: counter.periodEnd,
        }
      : null,
    limits: limits
      ? {
          coursesCreated: serializeLimit(limits.coursesCreated),
          projectReviews: serializeLimit(limits.projectReviews),
        }
      : null,
  };
}

function serializeLimit(n) {
  return n === Infinity ? null : n;
}

// Find or auto-create the current-period UsageCounter for a user.
// Period is derived from subscription.renewsAt - 1 month/year. For users
// without an active subscription, no counter exists.
export async function currentCounter(user) {
  if (!user?.subscription?.renewsAt) return null;
  const periodEnd = new Date(user.subscription.renewsAt);
  const periodStart = subOnePeriod(periodEnd, user.subscription.billingCycle || "monthly");
  return UsageCounter.findOneAndUpdate(
    { userId: user.userId, periodStart },
    { $setOnInsert: { userId: user.userId, periodStart, periodEnd } },
    { upsert: true, new: true }
  );
}

function subOnePeriod(date, cycle) {
  const d = new Date(date);
  if (cycle === "annual") d.setUTCFullYear(d.getUTCFullYear() - 1);
  else d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

// ---- Cancel / Resume ----

export async function cancelSubscription(userId) {
  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  const subId = user.subscription?.lemonSubscriptionId;
  if (!subId) throw new BadRequestError("No active subscription to cancel.");

  await ls.cancelSubscription(subId);

  // Optimistic local update — the subscription_cancelled webhook will
  // confirm and set the authoritative endsAt. We update immediately so
  // the UI reflects the change without waiting for the webhook RTT.
  user.subscription.status = "cancelled";
  user.subscription.endsAt = user.subscription.renewsAt || null;
  await user.save();

  logger.info(`[Billing] cancelSubscription -> ${userId}`);
  return { ok: true };
}

export async function resumeSubscription(userId) {
  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  const subId = user.subscription?.lemonSubscriptionId;
  if (!subId) throw new BadRequestError("No subscription to resume.");
  if (user.subscription.status !== "cancelled") {
    throw new BadRequestError("Subscription is not cancelled.");
  }

  await ls.resumeSubscription(subId);

  // Optimistic — webhook subscription_resumed will confirm.
  user.subscription.status = "active";
  user.subscription.endsAt = null;
  user.status = "active";
  await user.save();

  logger.info(`[Billing] resumeSubscription -> ${userId}`);
  return { ok: true };
}

// ---- Invoices ----

/**
 * Fetch invoices from LemonSqueezy for the user's subscription.
 * Pass-through with light normalization for the frontend.
 */
export async function listInvoices(userId) {
  const user = await User.findOne({ userId }).lean();
  if (!user) throw new NotFoundError("User not found");
  const subId = user.subscription?.lemonSubscriptionId;
  if (!subId) return { invoices: [] };

  const body = await ls.listSubscriptionInvoices(subId, { perPage: 50 });
  const items = Array.isArray(body?.data) ? body.data : [];
  // This endpoint can't sort, so order newest-first here.
  items.sort((a, b) => {
    const ta = new Date(a?.attributes?.created_at || 0).getTime();
    const tb = new Date(b?.attributes?.created_at || 0).getTime();
    return tb - ta;
  });
  const invoices = items.map((i) => {
    const a = i?.attributes || {};
    return {
      id: String(i?.id || ""),
      createdAt: a.created_at || null,
      status: a.status || "",                  // e.g. "paid", "void", "refunded", "pending"
      total: a.total || 0,                     // cents
      totalFormatted: a.total_formatted || "",
      currency: a.currency || "USD",
      invoiceUrl: a.urls?.invoice_url || "",
      billingReason: a.billing_reason || "",   // "initial" | "renewal" | "updated"
      cardBrand: a.card_brand || "",
      cardLastFour: a.card_last_four || "",
    };
  });
  return { invoices };
}

// ---- Webhook event handler ----

export async function handleWebhook(event) {
  const eventName = event?.meta?.event_name;
  const customData = event?.meta?.custom_data || {};
  const data = event?.data;
  if (!eventName || !data) {
    logger.warn("[Billing] Webhook with missing meta/data", { eventName });
    return { ok: false, reason: "bad_payload" };
  }

  const user = await findUserForWebhook(customData, data);
  if (!user) {
    logger.warn("[Billing] Webhook for unknown user", { eventName, customData });
    return { ok: false, reason: "unknown_user" };
  }

  switch (eventName) {
    case "subscription_created":     return onSubscriptionCreated(user, data);
    case "subscription_updated":     return onSubscriptionUpdated(user, data);
    case "subscription_cancelled":   return onSubscriptionCancelled(user, data);
    case "subscription_resumed":     return onSubscriptionResumed(user, data);
    case "subscription_expired":     return onSubscriptionExpired(user, data);
    case "subscription_payment_success": return onPaymentSuccess(user, data);
    case "subscription_payment_failed":  return onPaymentFailed(user, data);
    default:
      logger.info(`[Billing] Ignoring webhook event: ${eventName}`);
      return { ok: true, ignored: true };
  }
}

async function findUserForWebhook(customData, data) {
  // 1. Preferred: our custom_data.userId round-tripped via checkout.
  if (customData?.userId) {
    const u = await User.findOne({ userId: customData.userId });
    if (u) return u;
  }
  // 2. Fallback: existing lemonCustomerId match.
  const customerId = data?.attributes?.customer_id;
  if (customerId) {
    const u = await User.findOne({ "subscription.lemonCustomerId": String(customerId) });
    if (u) return u;
  }
  // 3. Last resort: email match.
  const email = data?.attributes?.user_email;
  if (email) {
    const u = await User.findOne({ email: String(email).toLowerCase() });
    if (u) return u;
  }
  return null;
}

function extractSubAttrs(data) {
  const a = data?.attributes || {};
  return {
    subscriptionId:   String(data?.id || ""),
    customerId:       a.customer_id ? String(a.customer_id) : null,
    variantId:        a.variant_id ? String(a.variant_id) : null,
    status:           a.status || null,
    renewsAt:         a.renews_at ? new Date(a.renews_at) : null,
    endsAt:           a.ends_at ? new Date(a.ends_at) : null,
    trialEndsAt:      a.trial_ends_at ? new Date(a.trial_ends_at) : null,
    cardBrand:        a.card_brand || "",
    cardLastFour:     a.card_last_four || "",
    portalUrl:        a.urls?.customer_portal || "",
    updatePaymentUrl: a.urls?.update_payment_method || "",
  };
}

// Persist an active/trialing subscription onto the user. Shared by the
// subscription_created webhook and the pull-based reconcile so both paths
// produce identical state.
async function applyActiveSubscription(user, s, mapped) {
  const onTrial = s.status === "on_trial";
  user.plan = mapped.plan;
  // A card-on-file trial keeps the user in `trialing` until the first
  // payment (subscription_payment_success) flips them to `active`.
  user.status = onTrial ? "trialing" : "active";
  user.trialEndsAt = onTrial ? s.trialEndsAt : null;
  user.subscription = {
    lemonCustomerId: s.customerId,
    lemonSubscriptionId: s.subscriptionId,
    lemonVariantId: s.variantId,
    status: s.status || "active",
    billingCycle: mapped.cycle,
    renewsAt: s.renewsAt,
    endsAt: null,
    cardBrand: s.cardBrand,
    cardLastFour: s.cardLastFour,
    customerPortalUrl: s.portalUrl,
    updatePaymentMethodUrl: s.updatePaymentUrl,
  };
  await user.save();
  await ensureCounter(user);
  return user;
}

async function onSubscriptionCreated(user, data) {
  const s = extractSubAttrs(data);
  const mapped = planFromVariant(s.variantId);
  if (!mapped) {
    logger.warn("[Billing] subscription_created: unknown variant", { variantId: s.variantId });
    return { ok: false, reason: "unknown_variant" };
  }
  await applyActiveSubscription(user, s, mapped);
  logger.info(`[Billing] subscription_created -> ${user.userId} plan=${user.plan} status=${user.status}`);
  return { ok: true };
}

// ---- Reconcile (pull-based, no webhook required) ----
//
// Called when a user returns from the hosted checkout. Pulls their latest
// subscription straight from LemonSqueezy and applies it, so access is
// granted even if the inbound webhook is delayed or can't reach this
// backend (e.g. local dev). Idempotent and safe to call repeatedly.
export async function syncSubscriptionFromLemon(userId) {
  const userDoc = await User.findOne({ userId });
  if (!userDoc) throw new NotFoundError("User not found");

  // Already provisioned — nothing to pull.
  if (
    userDoc.subscription?.lemonSubscriptionId &&
    ["trialing", "active"].includes(userDoc.status)
  ) {
    return getBillingState(userId);
  }

  let body;
  try {
    body = await ls.listSubscriptions({ email: userDoc.email });
  } catch (err) {
    logger.warn(`[Billing] reconcile: LS lookup failed for ${userId}: ${err.message}`);
    return getBillingState(userId);
  }

  const items = Array.isArray(body?.data) ? body.data : [];
  // The /subscriptions endpoint can't sort, so order newest-first here.
  items.sort((a, b) => {
    const ta = new Date(a?.attributes?.created_at || 0).getTime();
    const tb = new Date(b?.attributes?.created_at || 0).getTime();
    return tb - ta;
  });
  // Prefer a live subscription; fall back to the most recent one.
  const live = items.find((it) =>
    ["on_trial", "active", "past_due", "paused"].includes(it?.attributes?.status)
  );
  const chosen = live || items[0];
  if (!chosen) {
    logger.info(`[Billing] reconcile: no subscription found for ${userId}`);
    return getBillingState(userId);
  }

  const s = extractSubAttrs(chosen);
  // Map by variant; fall back to the plan/cycle the user chose at signup
  // when the variant isn't recognized (e.g. env variant IDs not wired).
  const mapped =
    planFromVariant(s.variantId) ||
    (userDoc.selectedPlan && PAID_PLANS.includes(userDoc.selectedPlan)
      ? { plan: userDoc.selectedPlan, cycle: userDoc.selectedCycle || "monthly" }
      : null);
  if (!mapped) {
    logger.warn(`[Billing] reconcile: unmappable variant ${s.variantId} for ${userId}`);
    return getBillingState(userId);
  }

  await applyActiveSubscription(userDoc, s, mapped);
  logger.info(`[Billing] reconcile -> ${userId} plan=${userDoc.plan} status=${userDoc.status}`);
  return getBillingState(userId);
}

async function onSubscriptionUpdated(user, data) {
  const s = extractSubAttrs(data);
  const mapped = planFromVariant(s.variantId);
  if (mapped) {
    user.plan = mapped.plan;
    user.subscription.billingCycle = mapped.cycle;
    user.subscription.lemonVariantId = s.variantId;
  }
  if (s.status) user.subscription.status = s.status;
  if (s.renewsAt) user.subscription.renewsAt = s.renewsAt;
  // ends_at being non-null implies a pending cancellation
  user.subscription.endsAt = s.endsAt;
  if (s.cardBrand) user.subscription.cardBrand = s.cardBrand;
  if (s.cardLastFour) user.subscription.cardLastFour = s.cardLastFour;
  if (s.portalUrl) user.subscription.customerPortalUrl = s.portalUrl;
  if (s.updatePaymentUrl) user.subscription.updatePaymentMethodUrl = s.updatePaymentUrl;
  // If a plan change updated renewsAt, ensure the counter for the new period exists.
  if (s.status === "active" && user.plan !== "free_trial") {
    user.status = "active";
  }
  await user.save();
  await ensureCounter(user);
  logger.info(`[Billing] subscription_updated -> ${user.userId} plan=${user.plan} status=${user.subscription.status}`);
  return { ok: true };
}

async function onSubscriptionCancelled(user, data) {
  const s = extractSubAttrs(data);
  user.subscription.status = "cancelled";
  user.subscription.endsAt = s.endsAt || s.renewsAt || user.subscription.renewsAt;
  await user.save();
  logger.info(`[Billing] subscription_cancelled -> ${user.userId} endsAt=${user.subscription.endsAt}`);
  return { ok: true };
}

async function onSubscriptionResumed(user, data) {
  const s = extractSubAttrs(data);
  user.subscription.status = "active";
  user.subscription.endsAt = null;
  if (s.renewsAt) user.subscription.renewsAt = s.renewsAt;
  user.status = "active";
  await user.save();
  logger.info(`[Billing] subscription_resumed -> ${user.userId}`);
  return { ok: true };
}

async function onSubscriptionExpired(user /*, data */) {
  user.subscription.status = "expired";
  user.plan = "free_trial";
  user.status = "expired";
  await user.save();
  logger.info(`[Billing] subscription_expired -> ${user.userId} dropped to free_trial`);
  return { ok: true };
}

async function onPaymentSuccess(user, data) {
  const s = extractSubAttrs(data);
  if (s.renewsAt) user.subscription.renewsAt = s.renewsAt;
  user.subscription.status = "active";
  user.status = "active";
  await user.save();
  await ensureCounter(user); // roll forward — new period creates fresh counter
  logger.info(`[Billing] payment_success -> ${user.userId} next renewsAt=${user.subscription.renewsAt}`);
  return { ok: true };
}

async function onPaymentFailed(user /*, data */) {
  user.subscription.status = "past_due";
  await user.save();
  logger.info(`[Billing] payment_failed -> ${user.userId} marked past_due`);
  return { ok: true };
}

// Make sure the UsageCounter for the user's current billing period exists.
async function ensureCounter(user) {
  if (!user?.subscription?.renewsAt) return null;
  return currentCounter(user);
}
