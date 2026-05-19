// ===========================================
// ElevenLabs TTS Wrapper (REST SSE)
// Uses the /stream/with-timestamps endpoint which supports:
//   - eleven_v3 model (audio tags like [excited], [whispers], etc.)
//   - PCM 16kHz output (matches AudioPublisher)
//   - Character-level alignment (for word-level karaoke)
//
// Endpoint:
//   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream/with-timestamps
//
// Response: text/event-stream (SSE), each event is JSON:
//   {
//     "audio_base64": "...",
//     "alignment": {
//       "characters": [...],
//       "character_start_times_seconds": [...],
//       "character_end_times_seconds": [...]
//     },
//     "normalized_alignment": { ... }
//   }
// ===========================================

import logger from "../../utils/logger.js";

/**
 * Stream TTS audio + char-level alignment via ElevenLabs REST SSE.
 *
 * Yields chunks: { pcm: Buffer, alignment: { chars, charStartTimesMs, charDurationsMs } | null }
 *
 * @param {string} text
 * @param {Object} [opts]
 * @returns {AsyncGenerator<{pcm: Buffer, alignment: object|null}>}
 */
export async function* streamTTS(text, opts = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not set in environment");
  }

  const voiceId =
    opts.voiceId ||
    process.env.ELEVENLABS_DEFAULT_VOICE_ID ||
    "21m00Tcm4TlvDq8ikWAM";
  const model =
    opts.model || process.env.ELEVENLABS_MODEL || "eleven_v3";
  const outputFormat =
    opts.outputFormat ||
    process.env.ELEVENLABS_OUTPUT_FORMAT ||
    "pcm_16000";

  // IMPORTANT: ElevenLabs expects `output_format` as a QUERY parameter on
  // streaming endpoints — body field is silently ignored, causing the server
  // to default to mp3_44100_128. When we then treat MP3 bytes as PCM in
  // AudioPublisher, the result is white-noise / "shoo shoo" static.
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `/stream/with-timestamps` +
    `?output_format=${encodeURIComponent(outputFormat)}`;

  logger.info(
    `[ElevenLabs TTS] REST stream (model=${model}, voice=${voiceId}, format=${outputFormat}, ${text.length} chars)`
  );

  const body = {
    text,
    model_id: model,
    // Keep output_format in body too for backwards compat with other endpoints
    output_format: outputFormat,
    voice_settings: opts.voiceSettings || {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  };

  // --- POST request ---
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`ElevenLabs request failed: ${err.message}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs error: HTTP ${res.status} ${errText.slice(0, 300)}`
    );
  }

  // --- Diagnostic: warn if the server returned the wrong content type ---
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("event-stream") && !ct.includes("json")) {
    logger.warn(
      `[ElevenLabs TTS] Unexpected content-type: "${ct}" — expected text/event-stream`
    );
  }

  // --- Parse SSE stream line-by-line ---
  // SSE chunks look like:
  //   data: {"audio_base64":"...","alignment":{...}}
  //   \n\n
  let buffer = "";
  let firstAudioLogged = false;
  const decoder = new TextDecoder("utf-8");

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });

    // Split by lines
    let lineEnd;
    while ((lineEnd = buffer.indexOf("\n")) !== -1) {
      const rawLine = buffer.slice(0, lineEnd).replace(/\r$/, "");
      buffer = buffer.slice(lineEnd + 1);

      // Skip blank lines and event-name lines
      if (!rawLine.trim() || rawLine.startsWith(":") || rawLine.startsWith("event:")) {
        continue;
      }

      // Some SSE servers omit "data: " prefix and send raw JSON per line.
      // Handle both cases.
      let jsonStr = rawLine;
      if (rawLine.startsWith("data:")) {
        jsonStr = rawLine.slice(5).trim();
      }
      if (!jsonStr || jsonStr === "[DONE]") continue;

      let msg;
      try {
        msg = JSON.parse(jsonStr);
      } catch {
        continue; // partial JSON line — ignore
      }

      // Normalize fields to our internal shape
      const yieldChunk = parseChunk(msg);

      // --- One-time diagnostic: confirm we received PCM, not MP3 ---
      if (!firstAudioLogged && yieldChunk?.pcm && yieldChunk.pcm.length > 4) {
        firstAudioLogged = true;
        const head = yieldChunk.pcm.subarray(0, 4);
        // MP3 frames start with 0xFF 0xFB (or 0xFF 0xFA, 0xFF 0xF3, 0xFF 0xF2)
        // PCM has no fixed signature — first bytes are arbitrary sample data.
        if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
          logger.error(
            "[ElevenLabs TTS] ⚠️  Received MP3 bytes but expected PCM! " +
              "Audio will be played as garbage (white noise). " +
              "Check that ELEVENLABS_OUTPUT_FORMAT is a pcm_* value."
          );
        } else {
          logger.info(
            `[ElevenLabs TTS] Audio confirmed (first bytes: ${[...head].map((b) => b.toString(16).padStart(2, "0")).join(" ")})`
          );
        }
      }

      if (yieldChunk) yield yieldChunk;
    }
  }

  // Flush remaining buffer (in case last line wasn't newline-terminated)
  if (buffer.trim()) {
    try {
      const last = buffer.startsWith("data:")
        ? buffer.slice(5).trim()
        : buffer.trim();
      if (last && last !== "[DONE]") {
        const msg = JSON.parse(last);
        const yieldChunk = parseChunk(msg);
        if (yieldChunk) yield yieldChunk;
      }
    } catch {}
  }
}

// ===========================================
// Helpers
// ===========================================

/**
 * Convert an SSE chunk JSON into our internal { pcm, alignment } shape.
 * Returns null if the chunk has no audio nor alignment.
 */
function parseChunk(msg) {
  if (!msg || typeof msg !== "object") return null;

  // --- Audio ---
  let pcm = null;
  const audioB64 = msg.audio_base64 || msg.audio || null;
  if (audioB64 && typeof audioB64 === "string") {
    try {
      pcm = Buffer.from(audioB64, "base64");
    } catch {
      pcm = null;
    }
  }

  // --- Alignment (prefer normalized_alignment if present — handles SSML-stripped chars) ---
  let alignment = null;
  const rawAlign = msg.normalized_alignment || msg.alignment || null;
  if (rawAlign) {
    const chars = rawAlign.characters || rawAlign.chars || [];
    const startSec =
      rawAlign.character_start_times_seconds ||
      rawAlign.char_start_times_seconds ||
      [];
    const endSec =
      rawAlign.character_end_times_seconds ||
      rawAlign.char_end_times_seconds ||
      [];

    if (chars.length > 0 && startSec.length === chars.length) {
      const charStartTimesMs = startSec.map((s) => Math.round(s * 1000));
      const charDurationsMs = chars.map((_, i) => {
        const s = startSec[i] ?? 0;
        const e = endSec[i] ?? s;
        return Math.max(0, Math.round((e - s) * 1000));
      });
      alignment = { chars, charStartTimesMs, charDurationsMs };
    }
  }

  if (!pcm && !alignment) return null;
  return { pcm: pcm || Buffer.alloc(0), alignment };
}

export default { streamTTS };
