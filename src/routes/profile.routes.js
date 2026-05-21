// ===========================================
// Profile Routes  (mounted at /api/profile)
// All routes require a valid Bearer access token —
// `authenticate` is applied at mount-time in app.js.
//
//   GET    /            full safe user
//   PATCH  /overview    name, phone, bio, avatarUrl
//   PATCH  /career      role / level / industry / skills / goal
//   PATCH  /social      github / linkedin / twitter / portfolio / other
// ===========================================

import { Router } from "express";
import { asyncHandler } from "../errors/index.js";
import * as profileService from "../services/profile.service.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await profileService.getProfile(req.user.userId);
    res.json({ user });
  })
);

router.patch(
  "/overview",
  asyncHandler(async (req, res) => {
    const user = await profileService.updateOverview(
      req.user.userId,
      req.body || {}
    );
    res.json({ user });
  })
);

router.patch(
  "/career",
  asyncHandler(async (req, res) => {
    const user = await profileService.updateCareer(
      req.user.userId,
      req.body || {}
    );
    res.json({ user });
  })
);

router.patch(
  "/social",
  asyncHandler(async (req, res) => {
    const user = await profileService.updateSocial(
      req.user.userId,
      req.body || {}
    );
    res.json({ user });
  })
);

export default router;
