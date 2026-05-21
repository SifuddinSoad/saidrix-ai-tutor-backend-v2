// ===========================================
// Billing Routes  (auth-gated, mounted at /api/billing).
// The webhook endpoint is mounted SEPARATELY in app.js
// because it needs the raw body for HMAC verification —
// see app.js where billingWebhookHandler is wired before
// express.json().
//
//   POST /checkout   {plan, cycle}  -> { url }
//   GET  /state                     -> { plan, subscription, usage, limits }
//   GET  /portal                    -> { url } LS customer portal
// ===========================================

import { Router } from "express";
import {
  asyncHandler,
  BadRequestError,
  NotFoundError,
} from "../errors/index.js";
import * as billingService from "../services/billing.service.js";
import User from "../db/models/User.js";
import { verifyLemonSignature } from "../utils/lemonWebhook.js";
import logger from "../utils/logger.js";

const router = Router();

router.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    const { plan, cycle } = req.body || {};
    const out = await billingService.startCheckout({
      userId: req.user.userId,
      plan,
      cycle,
    });
    res.json(out);
  })
);

router.get(
  "/state",
  asyncHandler(async (req, res) => {
    const out = await billingService.getBillingState(req.user.userId);
    res.json(out);
  })
);

router.get(
  "/portal",
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ userId: req.user.userId }).lean();
    if (!user) throw new NotFoundError("User not found");
    const url = user.subscription?.customerPortalUrl;
    if (!url) throw new BadRequestError("No customer portal — subscribe first.");
    res.json({ url });
  })
);

router.post(
  "/cancel",
  asyncHandler(async (req, res) => {
    const out = await billingService.cancelSubscription(req.user.userId);
    res.json(out);
  })
);

router.post(
  "/resume",
  asyncHandler(async (req, res) => {
    const out = await billingService.resumeSubscription(req.user.userId);
    res.json(out);
  })
);

router.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const out = await billingService.listInvoices(req.user.userId);
    res.json(out);
  })
);

export default router;

// ---- Webhook handler (exported, mounted with raw body in app.js) ----

export async function billingWebhookHandler(req, res, next) {
  try {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    const signature = req.get("x-signature") || "";
    const raw = req.body; // Buffer because express.raw is in front of this route
    if (!secret) {
      logger.error("[Billing] LEMONSQUEEZY_WEBHOOK_SECRET missing — rejecting webhook");
      return res.status(401).json({ error: "Webhook not configured" });
    }
    if (!verifyLemonSignature(raw, signature, secret)) {
      logger.warn("[Billing] Webhook signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }
    let event;
    try {
      event = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      return res.status(400).json({ error: "Malformed JSON" });
    }
    const result = await billingService.handleWebhook(event);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}
