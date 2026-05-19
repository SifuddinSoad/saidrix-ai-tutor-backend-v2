// ===========================================
// Deepgram STT Wrapper
// Streaming speech-to-text for student voice.
// UNVERIFIED: Exact STT class constructor/method API for v1.x of
// @livekit/agents-plugin-deepgram. The wrapper centralizes config
// so future SDK changes only touch this file.
// ===========================================

import * as deepgramPlugin from "@livekit/agents-plugin-deepgram";
import logger from "../../utils/logger.js";

/**
 * Create a new Deepgram STT instance configured for live streaming.
 *
 * Defaults:
 *   - model: nova-3 (multilingual)
 *   - language: "multi" (Bengali + English + more, auto-detect)
 *   - interim results enabled for low-latency feedback
 */
export function createSTT() {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY not set in environment");
  }

  const STTClass = deepgramPlugin.STT || deepgramPlugin.default?.STT;
  if (!STTClass) {
    throw new Error("@livekit/agents-plugin-deepgram does not export an STT class — check package version");
  }

  // UNVERIFIED: param names follow agents-js convention; verify against
  // npm package README if you upgrade the plugin.
  const stt = new STTClass({
    apiKey: process.env.DEEPGRAM_API_KEY,
    model: process.env.DEEPGRAM_MODEL || "nova-3",
    language: process.env.DEEPGRAM_LANGUAGE || "multi",
    interimResults: true,
    smartFormat: true,
    punctuate: true,
  });

  logger.info(`[STT] Deepgram STT created (model: ${process.env.DEEPGRAM_MODEL || "nova-3"})`);
  return stt;
}

export default { createSTT };
