// ===========================================
// LemonSqueezy REST API client — thin wrapper around
// https://api.lemonsqueezy.com/v1. Auth via Bearer key
// (LEMONSQUEEZY_API_KEY). Only the methods we actually use.
// Spec: https://docs.lemonsqueezy.com/api
// ===========================================

import { UpstreamError } from "../errors/index.js";

const API_BASE = "https://api.lemonsqueezy.com/v1";

function authHeaders() {
  const key = process.env.LEMONSQUEEZY_API_KEY;
  if (!key) {
    throw new UpstreamError("LemonSqueezy not configured (missing LEMONSQUEEZY_API_KEY).");
  }
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${key}`,
  };
}

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers || {}) },
    });
  } catch (err) {
    throw new UpstreamError("LemonSqueezy unreachable", { cause: err });
  }
  const text = await res.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new UpstreamError(
      `LemonSqueezy ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body?.errors || body)}`,
      { details: body }
    );
  }
  return body;
}

// ---- Checkouts ----

/**
 * Create a hosted checkout session.
 * @param {object} opts
 * @param {string} opts.variantId      LS variant id (numeric string)
 * @param {string} opts.userId         our internal userId — round-tripped via custom_data
 * @param {string} opts.email
 * @param {string} [opts.name]
 * @returns {Promise<string>}          checkout URL the user is redirected to
 */
export async function createCheckoutUrl({ variantId, userId, email, name }) {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!storeId) throw new UpstreamError("LEMONSQUEEZY_STORE_ID not set");

  const payload = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email,
          name: name || undefined,
          custom: { userId },
        },
      },
      relationships: {
        store:   { data: { type: "stores",   id: String(storeId) } },
        variant: { data: { type: "variants", id: String(variantId) } },
      },
    },
  };
  const body = await call("/checkouts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const url = body?.data?.attributes?.url;
  if (!url) throw new UpstreamError("LemonSqueezy: missing checkout url in response", { details: body });
  return url;
}

// ---- Subscriptions ----

export async function getSubscription(subscriptionId) {
  return call(`/subscriptions/${subscriptionId}`);
}

/**
 * Cancel a subscription. LS keeps it active until period end (sets ends_at).
 * The follow-up subscription_cancelled webhook will update our DB.
 */
export async function cancelSubscription(subscriptionId) {
  return call(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
}

/**
 * Resume a cancelled-but-not-yet-expired subscription.
 * LS clears ends_at and re-enables auto-renew.
 */
export async function resumeSubscription(subscriptionId) {
  const payload = {
    data: {
      type: "subscriptions",
      id: String(subscriptionId),
      attributes: { cancelled: false },
    },
  };
  return call(`/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// ---- Invoices ----

/**
 * List invoices for a given subscription, newest first.
 * Returns the raw LS response (paginated).
 */
export async function listSubscriptionInvoices(subscriptionId, { perPage = 25, page = 1 } = {}) {
  const qs = new URLSearchParams({
    "filter[subscription_id]": String(subscriptionId),
    "page[size]": String(perPage),
    "page[number]": String(page),
    sort: "-created_at",
  });
  return call(`/subscription-invoices?${qs.toString()}`);
}

// ---- Customers ----

export async function getCustomer(customerId) {
  return call(`/customers/${customerId}`);
}
