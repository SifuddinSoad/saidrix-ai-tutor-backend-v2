// ===========================================
// Lecture Explainer Orchestrator
// Replaces the shallow speech-enricher: each block is
// routed to a specialized explainer for a deep teaching
// explanation, then the combiner adds conversational tone
// + ElevenLabs tags. Output is written to the SAME
// EnrichedSegment collection the voice-tutor already
// reads — so the voice path needs no changes.
//
// Structurally mirrors speech-enricher/enricher.js, with
// bounded concurrency (each segment = 2 LLM calls).
// ===========================================

import { randomUUID } from "node:crypto";
import { lectureToSpeechPlan } from "../voice-tutor/lectureReader.js";
import { filterBlock } from "./filter.js";
import { explainers } from "./explainers/index.js";
import { enhance } from "./combiner.js";
import { enrichText } from "../speech-enricher/enricher.js";
import EnrichedSegment from "../../db/models/EnrichedSegment.js";
import { PIPELINE_VERSION } from "./pipelineVersion.js";
import logger from "../../utils/logger.js";

// Re-export so existing importers keep working.
export { PIPELINE_VERSION };

// Each segment costs 2 LLM calls (explainer + combiner); keep the
// in-flight count bounded so large lectures don't hammer rate limits.
const CONCURRENCY = 4;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Explain an entire lecture into EnrichedSegment rows.
 *
 * @param {Object}  lecture        Lecture doc (lean)
 * @param {Object}  [opts]
 * @param {boolean} [opts.force]   Re-explain even if cached segments exist
 * @returns {Promise<Array>}       Ordered segment summaries
 */
export async function explainLectureToDB(lecture, opts = {}) {
  if (!lecture || !lecture.lectureId) {
    throw new Error("[LectureExplainer] lecture with lectureId required");
  }
  const lectureId = lecture.lectureId;
  const force = !!opts.force;

  // --- Cache check (version-aware) ---
  // Cached segments are only reusable if they were produced by the
  // CURRENT pipeline version. Stale (older / unversioned) segments are
  // wiped so the new logic re-runs automatically.
  const existing = await EnrichedSegment.find({ lectureId, status: "ready" })
    .sort({ order: 1 })
    .lean();
  const fresh =
    existing.length > 0 &&
    existing.every(
      (s) => s?.metadata?.pipelineVersion === PIPELINE_VERSION
    );

  if (!force && fresh) {
    logger.info(
      `[LectureExplainer] Using cached ${existing.length} segments (v${PIPELINE_VERSION}) for lecture ${lectureId}`
    );
    return existing;
  }
  if (existing.length > 0) {
    logger.info(
      `[LectureExplainer] Cache invalidated (force=${force}, fresh=${fresh}) — re-enriching lecture ${lectureId}`
    );
  }
  if (force || (existing.length > 0 && !fresh)) {
    await EnrichedSegment.deleteMany({ lectureId });
  }

  // Reuse the canonical ordered plan (title -2, summary -1, empties skipped).
  const plan = lectureToSpeechPlan(lecture);
  const total = plan.length;
  logger.info(
    `[LectureExplainer] Explaining ${total} segments for lecture ${lectureId}...`
  );
  const t0 = Date.now();

  // Attach the stable order index before chunking.
  const indexed = plan.map((seg, order) => ({ seg, order }));

  const results = [];
  for (const batch of chunk(indexed, CONCURRENCY)) {
    const done = await Promise.all(
      batch.map(async ({ seg, order }) => {
        const segmentId = randomUUID();
        const originalText = seg.text;
        let enrichedText = originalText;
        let status = "ready";
        let error = null;
        let key = "text";

        try {
          let block;
          if (seg.blockIndex >= 0) {
            block = (lecture.blocks || [])[seg.blockIndex] || {
              type: "text",
              data: { content: seg.text },
            };
            key = filterBlock(block);
          } else {
            // -2 = title intro, -1 = summary → narrative text
            block = { type: "text", data: { content: seg.text } };
            key = "text";
          }

          if (key === "heading") {
            // A heading is just a section title. Skip BOTH the deep
            // explainer and the combiner/enhancer (which would expand it
            // into a chatty paragraph). Only add light emotion tags via
            // the tag-only enricher — short titles pass through unchanged.
            const headingText = String(
              block?.data?.content || seg.text || ""
            ).trim();
            logger.info(
              `[LectureExplainer] seg #${order} (block ${seg.blockIndex}) -> heading (tags only, no expansion)`
            );
            enrichedText = await enrichText(headingText);
            if (!enrichedText || !enrichedText.trim()) {
              enrichedText = headingText || originalText;
            }
          } else {
            const explainer = explainers[key] || explainers.text;
            logger.info(
              `[LectureExplainer] seg #${order} (block ${seg.blockIndex}) -> explainer '${key}'`
            );
            const explanation = await explainer.explain(block, {
              lecture,
              seg,
            });

            enrichedText = await enhance(explanation, {
              isFirst: order === 0,
              isLast: order === total - 1,
              lectureTitle: lecture.title,
            });
            if (!enrichedText || !enrichedText.trim()) {
              enrichedText = explanation || originalText;
            }
          }
        } catch (err) {
          error = err.message;
          status = "failed";
          enrichedText = originalText; // graceful fallback for playback
          logger.error(
            `[LectureExplainer] seg #${order} (explainer '${key}') failed: ${err.message}`
          );
        }

        await EnrichedSegment.findOneAndUpdate(
          { lectureId, order },
          {
            segmentId,
            lectureId,
            order,
            blockIndex: seg.blockIndex,
            originalText,
            enrichedText,
            status,
            error,
            metadata: { explainer: key, pipelineVersion: PIPELINE_VERSION },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return {
          segmentId,
          lectureId,
          order,
          blockIndex: seg.blockIndex,
          enrichedText,
          status,
        };
      })
    );
    results.push(...done);
  }

  const readyCount = results.filter((r) => r.status === "ready").length;
  const failedCount = results.length - readyCount;
  logger.info(
    `[LectureExplainer] Done: ${results.length} segments (${readyCount} ready, ${failedCount} failed) for lecture ${lectureId} in ${Date.now() - t0}ms`
  );
  if (failedCount > 0) {
    logger.warn(
      `[LectureExplainer] ${failedCount}/${results.length} segments failed — voice may skip/echo those parts`
    );
  }

  return results.sort((a, b) => a.order - b.order);
}

export default { explainLectureToDB };
