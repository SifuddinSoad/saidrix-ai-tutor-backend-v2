// ===========================================
// Image Enricher (standalone)
// Scans a Lecture's blocks for type=image entries that have no usable
// `data.url`, generates one image per missing block via the imagegen
// service, and writes the URL straight back to the Lecture doc.
//
// This is intentionally INDEPENDENT of explainLectureToDB so it still
// runs when the orchestrator's segment cache says "nothing to do" —
// the orchestrator skips work when EnrichedSegment rows are already
// present at the current pipeline version, which means cached lectures
// that never had images generated would never receive any. Calling
// this enricher in parallel with the orchestrator fixes the gap.
//
// Idempotent: a block whose data.url already starts with http(s) is
// left untouched.
// ===========================================

import { generateImage } from "../../services/imagegen.js";
import Lecture from "../../db/models/Lecture.js";
import logger from "../../utils/logger.js";

// Concurrency for image generation — DALL-E is slow and rate-limited,
// so go gentle. Two in flight at a time is plenty for a typical lecture.
const CONCURRENCY = 2;

function buildPrompt(block, lecture) {
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

function hasUsableUrl(block) {
  const u = block?.data?.url;
  return typeof u === "string" && /^https?:\/\//.test(u);
}

/**
 * Generate any missing images on a lecture, persisting URLs back to
 * `lecture.blocks[i].data.url`. Returns a summary.
 *
 * @param {string} lectureId
 * @returns {Promise<{ lectureId: string, generated: number, skipped: number, failed: number, total: number }>}
 */
export async function ensureLectureImages(lectureId) {
  const lecture = await Lecture.findOne({ lectureId }).lean();
  if (!lecture || !Array.isArray(lecture.blocks)) {
    return { lectureId, generated: 0, skipped: 0, failed: 0, total: 0 };
  }

  // Identify the candidate blocks (with their real array indices).
  const candidates = [];
  lecture.blocks.forEach((b, i) => {
    if (b?.type === "image" && !hasUsableUrl(b)) candidates.push({ block: b, index: i });
  });

  if (candidates.length === 0) {
    logger.info(`[ImageEnricher] ${lectureId} — no missing images`);
    return {
      lectureId,
      generated: 0,
      skipped: lecture.blocks.length,
      failed: 0,
      total: lecture.blocks.length,
    };
  }

  logger.info(
    `[ImageEnricher] ${lectureId} — generating ${candidates.length} image(s)...`
  );

  let generated = 0;
  let failed = 0;

  // Simple semaphore-style batching so we never have more than
  // CONCURRENCY image-gen calls in flight.
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const my = cursor++;
      const { block, index } = candidates[my];
      try {
        const { url } = await generateImage({
          prompt: buildPrompt(block, lecture),
        });
        if (url) {
          await Lecture.updateOne(
            { lectureId },
            { $set: { [`blocks.${index}.data.url`]: url } }
          );
          generated++;
          logger.info(
            `[ImageEnricher] ${lectureId} block ${index} ← ${url}`
          );
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        logger.warn(
          `[ImageEnricher] ${lectureId} block ${index} failed: ${err.message}`
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker())
  );

  logger.info(
    `[ImageEnricher] ${lectureId} — done (generated=${generated}, failed=${failed})`
  );

  return {
    lectureId,
    generated,
    failed,
    skipped: lecture.blocks.length - candidates.length,
    total: lecture.blocks.length,
  };
}

export default { ensureLectureImages };
