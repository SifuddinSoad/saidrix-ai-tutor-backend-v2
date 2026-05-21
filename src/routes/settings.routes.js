// ===========================================
// Settings Routes  (mounted at /api/settings)
// All routes require a valid Bearer access token —
// `authenticate` is applied at mount-time in app.js.
//
//   POST /password/request   {currentPassword, newPassword}
//   POST /password/confirm   {code}
//   POST /email/request      {newEmail, password}
//   POST /email/confirm      {code}
//   POST /contact            {subject, message}
// ===========================================

import { Router } from "express";
import { asyncHandler } from "../errors/index.js";
import * as settingsService from "../services/settings.service.js";

const router = Router();

router.post(
  "/password/request",
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const out = await settingsService.requestPasswordChange({
      userId: req.user.userId,
      currentPassword,
      newPassword,
    });
    res.json(out);
  })
);

router.post(
  "/password/confirm",
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    const out = await settingsService.confirmPasswordChange({
      userId: req.user.userId,
      code,
    });
    res.json(out);
  })
);

router.post(
  "/email/request",
  asyncHandler(async (req, res) => {
    const { newEmail, password } = req.body || {};
    const out = await settingsService.requestEmailChange({
      userId: req.user.userId,
      newEmail,
      password,
    });
    res.json(out);
  })
);

router.post(
  "/email/confirm",
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    const out = await settingsService.confirmEmailChange({
      userId: req.user.userId,
      code,
    });
    res.json(out);
  })
);

router.post(
  "/contact",
  asyncHandler(async (req, res) => {
    const { subject, message } = req.body || {};
    const out = await settingsService.submitContact({
      userId: req.user.userId,
      subject,
      message,
    });
    res.json(out);
  })
);

export default router;
