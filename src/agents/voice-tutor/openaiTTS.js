// ===========================================
// OpenAI TTS via OpenRouter
// Model: openai/gpt-4o-mini-tts-2025-12-15
//
// Endpoint:
//   POST https://openrouter.ai/api/v1/audio/speech
//
// Returns raw PCM at 24kHz → downsampled to 16kHz for AudioPublisher.
// No character-level alignment (word karaoke events are skipped).
// ===========================================

import logger from "../../utils/logger.js";
import { stripTags } from "../speech-enricher/tagsCatalog.js";

const INPUT_RATE = 24000;
const OUTPUT_RATE = 16000;

// Maps the first recognized ElevenLabs-style tag in a segment to an
// OpenAI TTS natural-language instruction so emotion is preserved.
const TAG_TO_INSTRUCTION = {
  excited:    "Speak with excitement and high energy.",
  happy:      "Speak in a warm, upbeat, happy tone.",
  curious:    "Speak with curiosity and wonder.",
  thoughtful: "Speak in a slow, thoughtful, reflective tone.",
  calm:       "Speak calmly and clearly.",
  serious:    "Speak in a serious, focused tone.",
  confident:  "Speak with confidence and authority.",
  warm:       "Speak in a warm, friendly, approachable tone.",
  gentle:     "Speak gently and softly.",
  playful:    "Speak in a playful, light-hearted tone.",
  whispers:   "Speak softly, almost in a whisper.",
  slow:       "Speak slowly and deliberately.",
  fast:       "Speak at a brisk, energetic pace.",
  pause:      "Speak naturally with slight pauses between ideas.",
};

const DEFAULT_INSTRUCTION = "Speak clearly and engagingly as a friendly tutor.";
const TAG_RE = /\[([^\[\]\n]+)\]/g;

function extractInstruction(text) {
  let match;
  while ((match = TAG_RE.exec(text)) !== null) {
    const key = match[1].toLowerCase().trim();
    if (TAG_TO_INSTRUCTION[key]) return TAG_TO_INSTRUCTION[key];
  }
  return DEFAULT_INSTRUCTION;
}

/**
 * Stream TTS audio via OpenRouter (OpenAI TTS).
 *
 * Yields chunks: { pcm: Buffer, alignment: null }
 *
 * @param {string} text
 * @param {Object} [opts]
 * @returns {AsyncGenerator<{pcm: Buffer, alignment: null}>}
 */
export async function* streamTTS(text, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set in environment");

  const model =
    opts.model ||
    process.env.OPENAI_TTS_MODEL ||
    "openai/gpt-4o-mini-tts-2025-12-15";
  const voice = opts.voice || process.env.OPENAI_TTS_VOICE || "alloy";

  // Strip ElevenLabs-style [tags] before sending to OpenAI TTS,
  // and map the first recognized tag to an instructions string.
  const instruction = opts.instructions || extractInstruction(text);
  const cleanText = stripTags(text);

  logger.info(
    `[OpenAI TTS] Requesting (model=${model}, voice=${voice}, instructions="${instruction}", ${cleanText.length} chars)`
  );

  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: cleanText,
        voice,
        response_format: "pcm",
        instructions: instruction,
      }),
    });
  } catch (err) {
    throw new Error(`OpenAI TTS request failed: ${err.message}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `OpenAI TTS error: HTTP ${res.status} ${errText.slice(0, 300)}`
    );
  }

  // Stream binary response body, downsample 24kHz → 16kHz per chunk
  let remainder = Buffer.alloc(0);
  let firstChunkLogged = false;

  for await (const raw of res.body) {
    const buf = Buffer.concat([remainder, Buffer.from(raw)]);

    // Keep only complete 16-bit samples (2 bytes each)
    const completeBytes = Math.floor(buf.length / 2) * 2;
    remainder = buf.subarray(completeBytes);

    if (completeBytes === 0) continue;

    const pcm24 = buf.subarray(0, completeBytes);
    const pcm16 = downsample(pcm24);

    if (!firstChunkLogged && pcm16.length > 0) {
      firstChunkLogged = true;
      logger.info(
        `[OpenAI TTS] First audio chunk received (${pcm16.length} bytes @ 16kHz)`
      );
    }

    if (pcm16.length > 0) {
      yield { pcm: pcm16, alignment: null };
    }
  }

  // Flush leftover bytes
  if (remainder.length >= 2) {
    const pcm16 = downsample(remainder.subarray(0, Math.floor(remainder.length / 2) * 2));
    if (pcm16.length > 0) {
      yield { pcm: pcm16, alignment: null };
    }
  }
}

/**
 * Downsample PCM from 24kHz to 16kHz (3:2 ratio) using linear interpolation.
 * Input: 16-bit signed little-endian Buffer at INPUT_RATE.
 * Output: 16-bit signed little-endian Buffer at OUTPUT_RATE.
 */
function downsample(input) {
  const inputSamples = input.length / 2;
  if (inputSamples === 0) return Buffer.alloc(0);

  const ratio = INPUT_RATE / OUTPUT_RATE; // 1.5
  const outputSamples = Math.floor(inputSamples / ratio);
  if (outputSamples === 0) return Buffer.alloc(0);

  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const srcFloor = Math.floor(srcPos);
    const srcCeil = Math.min(srcFloor + 1, inputSamples - 1);
    const frac = srcPos - srcFloor;

    const s0 = input.readInt16LE(srcFloor * 2);
    const s1 = input.readInt16LE(srcCeil * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);

    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }

  return output;
}

export default { streamTTS };
