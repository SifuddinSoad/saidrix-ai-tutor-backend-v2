// ===========================================
// Q&A Handler
// One turn of in-lecture Q&A:
//   1. Build LLM context (lecture + history + question)
//   2. Stream LLM response from OpenRouter
//   3. Chunk into sentences → OpenAI TTS → publish audio
//   4. Save Q&A pair to VoiceSession.transcripts
// ===========================================

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createLLM } from "../../utils/llm.js";
import { speakUnit } from "./speakUnit.js";
import { takeLeadingSentence } from "./textSplit.js";
import { buildQASystemPrompt } from "./qaPrompts.js";
import {
  sendStateInQA,
  sendStateReading,
  sendTranscript,
  sendQAResponseStart,
  sendQAResponseEnd,
} from "./dataChannel.js";
import VoiceSession from "../../db/models/VoiceSession.js";
import logger from "../../utils/logger.js";

/**
 * Build LLM context messages from lecture state + Q&A history + new question.
 * Pure function — exposed for testability.
 *
 * @param {Object} args
 * @param {Object} args.lecture
 * @param {Object} [args.currentBlock]
 * @param {Object[]} [args.recentBlocks]
 * @param {Array<{role,text}>} [args.qaHistory]   Prior Q&A turns
 * @param {string} args.question                  Student's question text
 * @returns {{system: string, history: Array<{role,content}>, question: string}}
 */
export function buildQAContext({
  lecture,
  currentBlock,
  recentBlocks = [],
  qaHistory = [],
  question,
}) {
  const system = buildQASystemPrompt({ lecture, currentBlock, recentBlocks });

  // Keep the last ~6 turns to bound context size
  const trimmed = (qaHistory || []).slice(-6);
  const history = trimmed.map((t) => ({
    role: t.role === "student" ? "user" : "assistant",
    content: t.text,
  }));

  return { system, history, question };
}

/**
 * Run a single Q&A turn end-to-end.
 *
 * @param {Object} args
 * @param {string} args.question
 * @param {Object} args.lecture
 * @param {number} args.currentBlockIndex
 * @param {Object} args.publisher        Phase-1 AudioPublisher
 * @param {Object} args.room             LiveKit Room
 * @param {string} args.sessionId
 */
export async function handleQuestion({
  question,
  lecture,
  currentBlockIndex,
  publisher,
  room,
  sessionId,
}) {
  const t0 = Date.now();
  logger.info(`[QA] Student question: "${question}"`);

  // --- 1. Notify clients + persist student question ---
  await sendStateInQA(room);
  await sendQAResponseStart(room);
  await sendTranscript(room, "student", question, currentBlockIndex);

  await VoiceSession.updateOne(
    { sessionId },
    {
      $push: {
        transcripts: {
          role: "student",
          text: question,
          blockIndex: currentBlockIndex,
        },
      },
      $inc: { qaCount: 1 },
      $set: { lastInteractionAt: new Date() },
    }
  );

  // --- 2. Load session for prior Q&A history ---
  const session = await VoiceSession.findOne({ sessionId }).lean();
  const qaHistory = session?.transcripts?.slice(0, -1) || []; // exclude the question we just added

  // --- 3. Build context for LLM ---
  const blocks = lecture.blocks || [];
  const currentBlock = blocks[currentBlockIndex] || null;
  const recentBlocks = blocks
    .slice(Math.max(0, currentBlockIndex - 2), currentBlockIndex)
    .filter(Boolean);

  const { system, history } = buildQAContext({
    lecture,
    currentBlock,
    recentBlocks,
    qaHistory,
    question,
  });

  // --- 4. Stream LLM response, accumulate into sentences ---
  // We use non-structured streaming. Each chunk's content is concatenated;
  // whenever we hit sentence-end punctuation we send a sentence to TTS.
  const llm = createLLM({ temperature: 0.6, streaming: true });

  const messages = [
    new SystemMessage({ content: system }),
    ...history.map((h) =>
      h.role === "user"
        ? new HumanMessage({ content: h.content })
        : new SystemMessage({ content: `Previous assistant reply: ${h.content}` })
    ),
    new HumanMessage({ content: question }),
  ];

  let buffer = "";
  let fullResponse = "";

  // Per-turn karaoke segment id (one per spoken sentence).
  const seg = { n: 0 };

  const flushSentence = async (text) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    await ttsSentence(trimmed, currentBlockIndex, publisher, room, seg.n++);
    await sendTranscript(room, "assistant", trimmed, currentBlockIndex);
  };

  try {
    const stream = await llm.stream(messages);

    for await (const chunk of stream) {
      const token =
        typeof chunk.content === "string"
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content.map((c) => c.text || "").join("")
            : "";
      if (!token) continue;

      buffer += token;
      fullResponse += token;

      // Flush every complete sentence currently in the buffer
      let taken;
      while ((taken = takeLeadingSentence(buffer))) {
        buffer = taken.rest;
        await flushSentence(taken.sentence);
      }
    }

    // Flush trailing remainder
    if (buffer.trim()) {
      await flushSentence(buffer);
    }
  } catch (err) {
    logger.error("[QA] LLM streaming failed:", err.message);
    // Speak a fallback so the student isn't left in silence
    await ttsSentence(
      "Sorry, I had trouble answering that. Let's continue the lecture.",
      currentBlockIndex,
      publisher,
      room,
      seg.n++
    );
  }

  // --- 5. Persist the full assistant reply ---
  if (fullResponse.trim()) {
    await VoiceSession.updateOne(
      { sessionId },
      {
        $push: {
          transcripts: {
            role: "assistant",
            text: fullResponse.trim(),
            blockIndex: currentBlockIndex,
          },
        },
        $set: { lastInteractionAt: new Date() },
      }
    );
  }

  // --- 6. Done ---
  await sendQAResponseEnd(room);
  await sendStateReading(room);

  logger.info(
    `[QA] Done in ${Date.now() - t0}ms (response ${fullResponse.length} chars)`
  );
}

// ===========================================
// Speak a single sentence: OpenAI TTS → publisher
// ===========================================

async function ttsSentence(text, blockIndex, publisher, room, segmentId) {
  // Heuristic karaoke (Approach 2: forced-align lecture, heuristic Q&A).
  await speakUnit({ text, segmentId, blockIndex, publisher, room });
}

export default { buildQAContext, handleQuestion };
