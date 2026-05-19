// ===========================================
// Silero VAD Wrapper
// Voice activity detection for student speech.
// UNVERIFIED: VAD class API confirmed only from agents-js README
// example. Constructor/load API may differ between SDK versions.
// ===========================================

import * as silero from "@livekit/agents-plugin-silero";
import logger from "../../utils/logger.js";

// --- Cached VAD model (heavy — load once per worker process) ---
let cachedVAD = null;

/**
 * Load (or return cached) Silero VAD model.
 * Should be called in worker prewarm to avoid first-job latency.
 */
export async function loadVAD() {
  if (cachedVAD) return cachedVAD;
  logger.info("[VAD] Loading Silero VAD model...");
  // UNVERIFIED: silero.VAD.load() signature from agents-js README.
  cachedVAD = await silero.VAD.load();
  logger.info("[VAD] Silero VAD model loaded");
  return cachedVAD;
}

export default { loadVAD };
