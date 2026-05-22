// ===========================================
// Image Generation
// OpenRouter does image generation through the chat/completions endpoint
// with `modalities` set — NOT the OpenAI /v1/images/generations route
// (that path 404s on OpenRouter). The generated image comes back inside
// choices[0].message.images[] as a data: URL (base64), which we upload
// to R2 for a stable public link. Some hosts return a hosted https URL,
// which we use directly.
//
// Note: image-only models (e.g. Sourceful Riverflow) reject the
// ["image","text"] modality combo — request just ["image"]. Override via
// IMAGE_GEN_MODALITIES if a model needs text too.
// ===========================================

import { randomUUID } from "crypto";
import logger from "../utils/logger.js";
import { uploadBuffer } from "./r2.client.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.IMAGE_GEN_MODEL || "google/gemini-2.5-flash-image";
const MODALITIES = (process.env.IMAGE_GEN_MODALITIES || "image")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TIMEOUT_MS = Number(process.env.IMAGE_GEN_TIMEOUT_MS) || 60000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function callOnce({ prompt, model }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const res = await withTimeout(
    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        modalities: MODALITIES,
      }),
    }),
    TIMEOUT_MS,
    "image generation"
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Image gen HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const img = data?.choices?.[0]?.message?.images?.[0];
  const url = img?.image_url?.url || img?.url || "";
  if (!url) throw new Error("Image gen returned no image in message.images");

  // Hosted URL → use directly. Data URL (base64) → upload to R2 for a
  // stable public link.
  if (/^https?:\/\//.test(url)) {
    return { url, persisted: false };
  }
  const m = /^data:(image\/[a-zA-Z0-9.+-]+)?;base64,(.+)$/s.exec(url);
  if (m) {
    const contentType = m[1] || "image/png";
    const ext = (contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
    const buf = Buffer.from(m[2], "base64");
    const key = `lecture-images/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    await uploadBuffer(key, buf, contentType);
    const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
    if (!publicBase) {
      throw new Error("Image gen returned base64 but R2_PUBLIC_URL not set");
    }
    return { url: `${publicBase}/${key}`, persisted: true };
  }
  throw new Error("Image gen returned an unrecognized image url format");
}

/**
 * Generate one image. Single retry on 5xx; surfaces all other failures.
 * Returns { url } or throws.
 */
export async function generateImage({ prompt, model = DEFAULT_MODEL } = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("generateImage: prompt (string) is required");
  }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await callOnce({ prompt, model });
      logger.info(
        `[ImageGen] ok (attempt ${attempt + 1}, ${out.persisted ? "r2" : "hosted"}): ${out.url}`
      );
      return out;
    } catch (err) {
      lastErr = err;
      const transient = (err.status && err.status >= 500) || /timed out|fetch failed|terminated/i.test(err.message || "");
      if (!transient || attempt === 1) break;
      logger.warn(`[ImageGen] retry: ${err.message}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

export default { generateImage };
