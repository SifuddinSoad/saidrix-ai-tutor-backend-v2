// Picture Explainer — generates a real image for the block (via DALL-E
// through OpenRouter), then has a vision model explain the ACTUAL image.
//
// Flow: generate/find image → write URL to `blocks[i].data.url` (so the
// frontend ImageBlock renders it) → vision-explain the real image. If
// image generation fails, we fall back to a description-based narration
// so the block still gets narrated.

import { runExplainer, runVisionExplainer } from "./_base.js";
import { generateImage } from "../../../services/imagegen.js";
import Lecture from "../../../db/models/Lecture.js";
import logger from "../../../utils/logger.js";

function buildImagePrompt(block, lecture) {
  const d = (block && block.data) || {};
  const subject = d.description || d.alt || d.caption || "";
  const title = lecture?.title || "";
  return [
    `Educational illustration for a lecture titled "${title}".`,
    subject && `Subject: ${subject}.`,
    "Style: clean, modern flat illustration, soft palette, light background, no text labels, no watermarks.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Ensure the block has a real image, generating one if missing. Returns
// the usable http(s) URL, or "" if none could be produced. Best-effort:
// any failure resolves to "" so narration can fall back gracefully.
async function ensureImage(block, ctx) {
  // Reuse an already-attached URL.
  const existing = block?.data?.url;
  if (existing && /^https?:\/\//.test(existing)) return existing;

  const blockIndex = ctx?.seg?.blockIndex;
  const lecture = ctx?.lecture;
  if (!lecture?.lectureId || typeof blockIndex !== "number" || blockIndex < 0) {
    return "";
  }

  try {
    const { url } = await generateImage({
      prompt: buildImagePrompt(block, lecture),
    });
    if (!url) return "";
    await Lecture.updateOne(
      { lectureId: lecture.lectureId },
      { $set: { [`blocks.${blockIndex}.data.url`]: url } }
    );
    logger.info(
      `[PictureExplainer] image attached → lecture ${lecture.lectureId} block ${blockIndex}`
    );
    return url;
  } catch (err) {
    logger.warn(
      `[PictureExplainer] image gen failed (block ${blockIndex}): ${err.message}`
    );
    return "";
  }
}

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const parts = [];
  if (d.description) parts.push(`Intended image content: ${d.description}`);
  if (d.alt) parts.push(`Alt text: ${d.alt}`);
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  const context = parts.join("\n");

  // 1) Make sure a real image exists (generate + persist if needed).
  const imageUrl = await ensureImage(block, ctx);

  // 2) Description-based narration is both the no-image fallback and the
  //    vision fallback (if the vision call fails/empties).
  const descNarration = await runExplainer("picture", context, ctx.seg.text);

  // 3) If we have a real image, explain THAT image via vision. Otherwise
  //    keep the description-based narration.
  if (imageUrl) {
    return runVisionExplainer("pictureVision", {
      imageUrl,
      contextText: context || "Explain this educational image.",
      fallback: descNarration,
    });
  }

  return descNarration;
}

export default { explain };
