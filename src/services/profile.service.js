// ===========================================
// Profile Service
// Handles GET + PATCH of the user's profile / career
// / social sub-documents. Validation is strict at the
// boundary; nothing here ever touches passwordHash,
// email, plan, or role — those live in dedicated
// flows.
// ===========================================

import User from "../db/models/User.js";
import { BadRequestError, NotFoundError } from "../errors/index.js";

// --- helpers ------------------------------------------------------------

function asString(v, max) {
  if (v === undefined || v === null) return undefined; // leave field untouched
  if (typeof v !== "string") throw new BadRequestError("Invalid string value");
  const s = v.trim();
  if (max && s.length > max) {
    throw new BadRequestError(`Value exceeds max length (${max})`);
  }
  return s;
}

function asUrl(v, max) {
  const s = asString(v, max);
  if (s === undefined) return undefined;
  if (s === "") return ""; // allow clearing
  // Loose URL check — must start with http(s) or be a bare username/handle.
  if (!/^https?:\/\/.+/i.test(s)) {
    throw new BadRequestError("Link must start with http:// or https://");
  }
  return s;
}

function asSkills(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    throw new BadRequestError("skills must be an array of strings");
  }
  if (v.length > 20) {
    throw new BadRequestError("At most 20 skills allowed");
  }
  const cleaned = v.map((s) => {
    if (typeof s !== "string") {
      throw new BadRequestError("Each skill must be a string");
    }
    const t = s.trim();
    if (!t) throw new BadRequestError("Skill cannot be empty");
    if (t.length > 30) throw new BadRequestError("Skill too long (max 30)");
    return t;
  });
  // de-dup, preserving order
  return Array.from(new Set(cleaned));
}

// Apply non-undefined fields onto a nested doc, then return the user.
function applyPatch(user, group, patch) {
  if (!user[group]) user[group] = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) user[group][k] = v;
  }
  user.markModified(group);
}

// --- public API ---------------------------------------------------------

export async function getProfile(userId) {
  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");
  return user.toSafeJSON();
}

export async function updateOverview(userId, body) {
  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");

  // Name lives on the user root, not in `profile`.
  const name = asString(body?.name, 80);
  if (name !== undefined) {
    if (name.length < 2) {
      throw new BadRequestError("Name must be at least 2 characters");
    }
    user.name = name;
  }

  applyPatch(user, "profile", {
    phone:     asString(body?.phone, 40),
    bio:       asString(body?.bio, 500),
    avatarUrl: asUrl(body?.avatarUrl, 500),
  });

  await user.save();
  return user.toSafeJSON();
}

export async function updateCareer(userId, body) {
  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");

  applyPatch(user, "career", {
    currentRole:     asString(body?.currentRole, 120),
    experienceLevel: asString(body?.experienceLevel, 60),
    industry:        asString(body?.industry, 120),
    targetRole:      asString(body?.targetRole, 120),
    careerGoal:      asString(body?.careerGoal, 1000),
    skills:          asSkills(body?.skills),
  });

  await user.save();
  return user.toSafeJSON();
}

export async function updateSocial(userId, body) {
  const user = await User.findOne({ userId });
  if (!user) throw new NotFoundError("User not found");

  applyPatch(user, "social", {
    github:    asUrl(body?.github, 200),
    linkedin:  asUrl(body?.linkedin, 200),
    twitter:   asUrl(body?.twitter, 200),
    portfolio: asUrl(body?.portfolio, 200),
    other:     asUrl(body?.other, 200),
  });

  await user.save();
  return user.toSafeJSON();
}

export default { getProfile, updateOverview, updateCareer, updateSocial };
