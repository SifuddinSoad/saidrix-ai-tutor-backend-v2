// ===========================================
// LLM Configuration (OpenRouter)
// Uses ChatOpenAI with custom baseURL for
// OpenRouter's OpenAI-compatible API
// ===========================================

import { ChatOpenAI } from "@langchain/openai";

// --- LLM Factory Function ---
// Creates a new ChatOpenAI instance configured for OpenRouter
// Use this when you need a custom model/temperature per agent

export function createLLM(options = {}) {
  const {
    model = process.env.OPENROUTER_MODEL || "openai/gpt-4o",
    temperature = 0.7,
    streaming = true,
    maxTokens = undefined,
    // Hard per-request HTTP timeout so a stalled upstream can't hang the
    // whole job forever. maxRetries bounds transient-failure backoff.
    timeout = Number(process.env.LLM_TIMEOUT_MS) || 90000,
    maxRetries = Number(process.env.LLM_MAX_RETRIES) || 2,
  } = options;

  return new ChatOpenAI({
    modelName: model,
    temperature,
    streaming,
    maxTokens,
    timeout,
    maxRetries,
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      timeout,
    },
  });
}

// --- Singleton LLM Instance ---
// Default LLM for general use across the app

export const llm = createLLM();

export default llm;
