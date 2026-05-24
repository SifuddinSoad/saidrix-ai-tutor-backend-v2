// ===========================================
// Chat Agent Graph (LangGraph)
// Core ReAct agent using createReactAgent
// Handles tool calling and streaming responses
// ===========================================

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import { createLLM } from "../../utils/llm.js";
import { getTools } from "./tools.js";
import { buildSystemPrompt } from "./prompts.js";
import { sessionCache } from "./memory.js";
import { extractAskBlocks } from "./extractAsk.js";
import { extractCourseRefs } from "./extractCourse.js";
import { extractProposal } from "./extractProposal.js";
import { detectLanguage } from "../../utils/detectLanguage.js";
import ToolCallLog from "../../db/models/ToolCallLog.js";
import logger from "../../utils/logger.js";

// ===========================================
// Agent Setup
// ===========================================

// --- LangGraph Checkpointer ---
// In-memory checkpointer for thread-level state
// (separate from MongoDB persistence in memory.js)

const checkpointer = new MemorySaver();

// --- Create the Chat Agent ---
// Returns a compiled LangGraph StateGraph

export function createChatAgent(options = {}) {
  const {
    model = undefined,
    temperature = undefined,
    customPrompt = undefined,
  } = options;

  // Create LLM (use custom settings or defaults)
  const llm = createLLM({
    ...(model && { model }),
    ...(temperature && { temperature }),
  });

  // Get all available tools
  const tools = getTools();

  // Build system prompt
  const systemPrompt = customPrompt || buildSystemPrompt();

  // Create the ReAct agent graph
  // This automatically handles: LLM call -> tool decision -> tool execution -> loop
  const agent = createReactAgent({
    llm,
    tools,
    checkpointSaver: checkpointer,
    messageModifier: systemPrompt,
  });

  logger.info(`[Agent] Chat agent created with ${tools.length} tools`);
  return agent;
}

// --- Default Agent Singleton ---

let defaultAgent = null;

function getDefaultAgent() {
  if (!defaultAgent) {
    defaultAgent = createChatAgent();
  }
  return defaultAgent;
}

// ===========================================
// [CreateCourse] command parser
// The proposal card sends a synthetic message:
//   [CreateCourse] "<title>" — topic: X, level: Y, goals: Z, duration: W
// This is a mechanical command, NOT a conversation turn — it must NOT
// go through the chat LLM (which narrates research, dumps roadmaps,
// leaks IDs no matter the prompt). Parse it and run the course-maker
// directly. Returns null if the text is not a create command.
// ===========================================

export function parseCreateCourseCommand(text) {
  if (typeof text !== "string") return null;
  const head = text.match(/^\s*\[CreateCourse\]\s*"([^"]+)"\s*[—–-]\s*(.+)$/s);
  if (!head) return null;

  const title = head[1].trim();
  const rest = head[2];

  const grab = (key, nextKeys) => {
    const re = new RegExp(
      `${key}:\\s*(.*?)\\s*(?=,\\s*(?:${nextKeys})\\s*:|$)`,
      "is",
    );
    const m = rest.match(re);
    return m ? m[1].trim() : "";
  };

  const topic = grab("topic", "level|goals|duration") || title;
  const levelRaw = (grab("level", "goals|duration|topic") || "").toLowerCase();
  const level = ["beginner", "intermediate", "advanced"].includes(levelRaw)
    ? levelRaw
    : "beginner";
  const goals = grab("goals", "duration|level|topic");
  const duration = grab("duration", "goals|level|topic");

  return { title, topic, level, goals, duration };
}

// ===========================================
// [CreateProject] command parser
//   [CreateProject] "<courseId>" — context: <free text>
// Mechanical command (like [CreateCourse]) — bypasses the chat LLM.
// `context` is the learner's stated focus (optional). Returns null
// if the text is not a create-project command.
// ===========================================

export function parseCreateProjectCommand(text) {
  if (typeof text !== "string") return null;
  const head = text.match(
    /^\s*\[CreateProject\]\s*"([^"]+)"\s*(?:[—–-]\s*(.+))?$/s,
  );
  if (!head) return null;

  const courseId = head[1].trim();
  const rest = head[2] || "";
  const m = rest.match(/context:\s*(.*)$/is);
  const context = m ? m[1].trim() : "";

  return { courseId, context };
}

// ===========================================
// [CreateRoutine] command parser
//   [CreateRoutine] "<courseId>[,<courseId>...]" — dailyHours: X,
//                   totalDays: Y, readingTime: "evening 8-10pm",
//                   startDate: YYYY-MM-DD
// All k/v pairs after the dash are optional; the LLM emits this command
// only AFTER asking the user for daily time, total days, and reading
// time. Returns null if the text is not a create-routine command.
// ===========================================

// Loose finder: scans anywhere in the text. Used when intercepting an
// LLM-emitted command from inside its own response (the LLM often wraps
// the line in preamble despite the prompt forbidding it).
export function findCreateRoutineCommand(text) {
  if (typeof text !== "string") return null;
  // Capture the courseId list + the trailing params (until newline or
  // end of string). Note: NO anchors and no /s, so it matches inline.
  const m = text.match(
    /\[CreateRoutine\]\s*"([^"]+)"\s*(?:[—–\-]\s*([^\n\r]*))?/i,
  );
  if (!m) return null;
  const courseIds = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  if (courseIds.length === 0) return null;
  const rest = m[2] || "";
  const hoursM = rest.match(/dailyHours:\s*([\d.]+)/i);
  const totalM = rest.match(/totalDays:\s*(\d+)/i);
  const dateM  = rest.match(/startDate:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  const readM  = rest.match(/readingTime:\s*"([^"]+)"/i) ||
                 rest.match(/readingTime:\s*([^,]+?)(?:,|$)/i);
  return {
    courseIds,
    dailyHours: hoursM ? Number(hoursM[1]) || 0 : 0,
    totalDays:  totalM ? Number(totalM[1]) || 0 : 0,
    readingTime: readM ? readM[1].trim() : "",
    startDate:  dateM ? dateM[1] : null,
  };
}

export function parseCreateRoutineCommand(text) {
  if (typeof text !== "string") return null;
  const head = text.match(
    /^\s*\[CreateRoutine\]\s*"([^"]+)"\s*(?:[—–-]\s*(.+))?$/s,
  );
  if (!head) return null;

  const courseIds = head[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (courseIds.length === 0) return null;

  const rest = head[2] || "";
  const hoursM = rest.match(/dailyHours:\s*([\d.]+)/i);
  const totalM = rest.match(/totalDays:\s*(\d+)/i);
  const dateM = rest.match(/startDate:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  // readingTime accepts either "quoted string" or bare-until-comma value.
  const readM = rest.match(/readingTime:\s*"([^"]+)"/i) ||
    rest.match(/readingTime:\s*([^,]+?)(?:,|$)/i);

  return {
    courseIds,
    // 0 here means "let the agent auto-derive from totalDays + course size"
    dailyHours: hoursM ? Number(hoursM[1]) || 0 : 0,
    totalDays:  totalM ? Number(totalM[1]) || 0 : 0,
    readingTime: readM ? readM[1].trim() : "",
    startDate:  dateM ? dateM[1] : null,
  };
}

// ===========================================
// Agent Invocation
// ===========================================

// --- Invoke Chat Agent (Streaming) ---
// Async generator that yields streamed response chunks
// Handles conversation history and persistence

export async function* invokeChatAgent(sessionId, userMessage, options = {}) {
  const {
    agent = getDefaultAgent(),
    messageId = null,
    userId = null,
  } = options;

  try {
    logger.info(`[Agent] Processing message for session: ${sessionId}`);

    // Save user message to cache + MongoDB
    const humanMsg = new HumanMessage({ content: userMessage });
    await sessionCache.append(sessionId, humanMsg);

    // ---- Deterministic [CreateCourse] handler (bypass the LLM) ----
    // Course creation is a mechanical command, not a chat turn. Running
    // it through the ReAct LLM makes it narrate research, dump roadmaps,
    // and leak IDs regardless of the prompt. Handle it directly: call the
    // course-maker, stream ONLY a clean summary + the hidden course block.
    const cmd = parseCreateCourseCommand(userMessage);
    if (cmd) {
      const toolCallId = randomUUID();
      const startedAt = new Date();

      yield { type: "tool_start", toolCallId, toolName: "create_course" };
      ToolCallLog.create({
        toolCallId,
        sessionId,
        messageId,
        toolName: "create_course",
        status: "running",
        startedAt,
      }).catch((err) =>
        logger.warn(`[Agent] ToolCallLog start write failed: ${err.message}`),
      );

      // Auto-detect the learner's language from their natural-language
      // messages this session — the [CreateCourse] command is
      // language-neutral, so infer it from the surrounding conversation.
      let language = "English";
      try {
        const hist = await sessionCache.get(sessionId);
        const userText = (hist || [])
          .filter((m) => m?._getType?.() === "human")
          .map((m) => (typeof m.content === "string" ? m.content : ""))
          .filter((t) => t && !/^\s*\[(CreateCourse|CreateProject|CreateRoutine)\]/.test(t))
          .slice(-6)
          .join("\n");
        language = detectLanguage(userText);
      } catch { /* default English */ }

      let summary = "";
      let courseRefs = [];
      let toolOutput = "";
      try {
        const mod = await import("../course-maker/graph.js");
        const result = await mod.invokeCourseMaker({
          topic: cmd.topic,
          level: cmd.level,
          goals: cmd.goals,
          duration: cmd.duration,
          language,
          sessionId,
          userId,
        });
        summary = (result?.summary || "").trim();
        if (result?.courseId) {
          courseRefs = [{ courseId: result.courseId }];
        }
        toolOutput = summary || "(course created)";
      } catch (err) {
        logger.error(`[Agent] create_course command failed: ${err.message}`);
        summary = `❌ Course toiri kora gelo na: ${err.message}`;
        toolOutput = summary;
      }

      const completedAt = new Date();
      const durationMs = completedAt - startedAt;

      ToolCallLog.findOneAndUpdate(
        { toolCallId },
        {
          sessionId,
          messageId,
          toolName: "create_course",
          status: "complete",
          output: String(toolOutput).slice(0, 4000),
          startedAt,
          completedAt,
          durationMs,
        },
        { upsert: true, setDefaultsOnInsert: true },
      ).catch((err) =>
        logger.warn(`[Agent] ToolCallLog result write failed: ${err.message}`),
      );

      yield {
        type: "tool_result",
        toolCallId,
        toolName: "create_course",
        content: String(toolOutput).slice(0, 4000),
        durationMs,
      };

      // Persist ONLY the clean summary (no LLM narration ever generated).
      const { AIMessage } = await import("@langchain/core/messages");
      const aiMsg = new AIMessage({ content: summary });
      const additional = {};
      if (courseRefs.length) additional.courseRefs = courseRefs;
      if (messageId) additional.messageId = messageId;
      if (Object.keys(additional).length > 0) {
        aiMsg.additional_kwargs = additional;
      }
      await sessionCache.append(sessionId, aiMsg);

      yield {
        type: "end",
        content: summary,
        prompts: [],
        courseRefs,
        proposal: null,
      };

      logger.info(
        `[Agent] [CreateCourse] handled directly for "${cmd.title}" (${durationMs}ms, ${courseRefs.length} ref)`,
      );
      return;
    }

    // ---- Deterministic [CreateProject] handler (bypass the LLM) ----
    const projCmd = parseCreateProjectCommand(userMessage);
    if (projCmd) {
      const toolCallId = randomUUID();
      const startedAt = new Date();
      yield { type: "tool_start", toolCallId, toolName: "create_project" };

      let summary = "";
      try {
        const CourseModel = (await import("../../db/models/Course.js")).default;
        const course = await CourseModel.findOne({
          courseId: projCmd.courseId,
        }).lean();
        if (!course) {
          throw new Error(`Course ${projCmd.courseId} not found`);
        }
        const mod = await import("../project-maker/graph.js");
        const result = await mod.invokeProjectMaker({
          courseId: projCmd.courseId,
          course,
          sessionId,
          userContext: projCmd.context,
          source: "chat",
          userId,
        });
        summary = (result?.summary || "").trim() || "(projects created)";
      } catch (err) {
        logger.error(`[Agent] create_project command failed: ${err.message}`);
        summary = `❌ Project toiri kora gelo na: ${err.message}`;
      }

      const durationMs = new Date() - startedAt;
      yield {
        type: "tool_result",
        toolCallId,
        toolName: "create_project",
        content: summary,
        durationMs,
      };

      const { AIMessage } = await import("@langchain/core/messages");
      const aiMsg = new AIMessage({ content: summary });
      if (messageId) aiMsg.additional_kwargs = { messageId };
      await sessionCache.append(sessionId, aiMsg);

      yield {
        type: "end",
        content: summary,
        prompts: [],
        courseRefs: [],
        proposal: null,
      };
      logger.info(
        `[Agent] [CreateProject] handled directly for course ${projCmd.courseId} (${durationMs}ms)`,
      );
      return;
    }

    // ---- Deterministic [CreateRoutine] handler (bypass the LLM) ----
    const routineCmd = parseCreateRoutineCommand(userMessage);
    if (routineCmd) {
      const toolCallId = randomUUID();
      const startedAt = new Date();
      yield { type: "tool_start", toolCallId, toolName: "create_routine" };

      let summary = "";
      try {
        const mod = await import("../routine-manager/graph.js");
        const result = await mod.invokeRoutineManager({
          courseIds: routineCmd.courseIds,
          dailyHours: routineCmd.dailyHours,
          totalDays: routineCmd.totalDays,
          readingTime: routineCmd.readingTime,
          startDate: routineCmd.startDate
            ? new Date(routineCmd.startDate)
            : new Date(),
          sessionId,
          userId,
        });
        summary = (result?.summary || "").trim() || "(routine created)";
      } catch (err) {
        logger.error(`[Agent] create_routine command failed: ${err.message}`);
        summary = `❌ Routine toiri kora gelo na: ${err.message}`;
      }

      const durationMs = new Date() - startedAt;
      yield {
        type: "tool_result",
        toolCallId,
        toolName: "create_routine",
        content: summary,
        durationMs,
      };

      const { AIMessage } = await import("@langchain/core/messages");
      const aiMsg = new AIMessage({ content: summary });
      if (messageId) aiMsg.additional_kwargs = { messageId };
      await sessionCache.append(sessionId, aiMsg);

      yield {
        type: "end",
        content: summary,
        prompts: [],
        courseRefs: [],
        proposal: null,
      };
      logger.info(
        `[Agent] [CreateRoutine] handled directly for [${routineCmd.courseIds.join(", ")}] (${durationMs}ms)`,
      );
      return;
    }

    // Stream the agent response
    // streamMode "messages" gives token-by-token AIMessageChunk objects
    const stream = await agent.stream(
      { messages: [humanMsg] },
      {
        // userId is read by tools (list_my_courses) at invocation time.
        configurable: { thread_id: sessionId, userId },
        streamMode: "messages",
      },
    );

    // Accumulate the full response for persistence
    let fullResponse = "";

    // When the LLM itself emits a `[CreateRoutine] ...` line as its
    // reply (instead of going through a frontend round-trip), we have to
    // intercept it. Buffer the first ~32 chars before yielding any
    // tokens so we can decide whether to suppress the stream and run
    // the deterministic routine handler instead.
    let routineBuffer = "";
    let suppressTokens = false;
    let routineCommandFound = null;
    const COMMAND_SNIFF = 32;
    function looksLikeRoutineStart(s) {
      const trimmed = s.trimStart();
      // Could still be growing; allow partial match.
      return /^\[CreateRoutine\]?/i.test(trimmed) &&
        "[CreateRoutine]".startsWith(trimmed.slice(0, "[CreateRoutine]".length));
    }

    // Track tool calls that have started so we can correlate start → result
    // and avoid duplicate `tool_start` events as tool_call_chunks stream in.
    const toolStarts = new Map(); // toolCallId -> { name, startedAt }

    // When create_course runs, its return value is the ONLY thing the user
    // should see (a short ✅ line + chapter table + hidden course block).
    // Models keep narrating their research around it no matter what the
    // prompt says, so we override the visible message deterministically.
    const createCourseOutputs = [];

    for await (const [chunk, metadata] of stream) {
      // ===== Agent node — text tokens + tool-call announcements =====
      if (metadata?.langgraph_node === "agent") {
        // Detect new tool calls as their chunks stream in
        const tcChunks = chunk.tool_call_chunks || [];
        for (const tc of tcChunks) {
          const id = tc.id;
          const name = tc.name;
          if (!id || !name || toolStarts.has(id)) continue;
          toolStarts.set(id, { name, startedAt: Date.now() });

          ToolCallLog.create({
            toolCallId: id,
            sessionId,
            messageId,
            toolName: name,
            status: "running",
            startedAt: new Date(),
          }).catch((err) =>
            logger.warn(
              `[Agent] ToolCallLog start write failed: ${err.message}`,
            ),
          );

          yield {
            type: "tool_start",
            toolCallId: id,
            toolName: name,
          };
        }

        if (chunk.content) {
          const token =
            typeof chunk.content === "string"
              ? chunk.content
              : JSON.stringify(chunk.content);
          fullResponse += token;

          if (suppressTokens) {
            // Already decided to swallow this turn's text.
            continue;
          }

          if (routineBuffer.length < COMMAND_SNIFF) {
            routineBuffer += token;
            if (looksLikeRoutineStart(routineBuffer)) {
              // Still maybe a command — keep buffering until we are sure.
              if (/\[CreateRoutine\]\s*"/i.test(routineBuffer)) {
                suppressTokens = true; // confirmed; never yield this turn
                continue;
              }
              if (routineBuffer.length < COMMAND_SNIFF) continue;
            }
            // Not a routine command — flush whatever we buffered.
            yield { type: "token", content: routineBuffer };
            routineBuffer = "";
            continue;
          }

          yield { type: "token", content: token };
        }
      }

      // ===== Tools node — tool result =====
      if (metadata?.langgraph_node === "tools" && chunk.content) {
        const toolName = chunk.name || "unknown";
        const content =
          typeof chunk.content === "string"
            ? chunk.content
            : JSON.stringify(chunk.content);

        if (toolName === "create_course") {
          createCourseOutputs.push(content);
        }

        // Correlate with the start we recorded (tool_call_id is the link)
        const toolCallId = chunk.tool_call_id || randomUUID();
        const startedRec = toolStarts.get(toolCallId);
        const startedAt = startedRec
          ? new Date(startedRec.startedAt)
          : new Date();
        const completedAt = new Date();
        const durationMs = completedAt - startedAt;

        ToolCallLog.findOneAndUpdate(
          { toolCallId },
          {
            sessionId,
            messageId,
            toolName,
            status: "complete",
            output: content.slice(0, 4000),
            startedAt,
            completedAt,
            durationMs,
          },
          { upsert: true, setDefaultsOnInsert: true },
        ).catch((err) =>
          logger.warn(
            `[Agent] ToolCallLog result write failed: ${err.message}`,
          ),
        );

        yield {
          type: "tool_result",
          toolCallId,
          toolName,
          content,
          durationMs,
        };
      }
    }

    // ---- Intercept LLM-emitted [CreateRoutine] command ----
    // The buffered/suppressed tokens stay in fullResponse; scan it
    // anywhere (LLM often wraps the line in preamble despite the
    // prompt). If found, run the routine-manager deterministically.
    if (/\[CreateRoutine\]\s*"/.test(fullResponse)) {
      routineCommandFound = findCreateRoutineCommand(fullResponse);
      logger.info(
        `[Agent] LLM emitted [CreateRoutine]; parsed=${!!routineCommandFound}` +
          (routineCommandFound
            ? ` courseIds=${routineCommandFound.courseIds.join(",")} totalDays=${routineCommandFound.totalDays} readingTime="${routineCommandFound.readingTime}"`
            : "")
      );
    }

    if (routineCommandFound) {
      const toolCallId = randomUUID();
      const startedAt = new Date();
      yield { type: "tool_start", toolCallId, toolName: "create_routine" };

      let summary = "";
      try {
        const mod = await import("../routine-manager/graph.js");
        // Validate startDate isn't in the past (LLM sometimes hallucinates).
        let startDate = routineCommandFound.startDate
          ? new Date(routineCommandFound.startDate)
          : new Date();
        if (isNaN(startDate.getTime()) || startDate < new Date(Date.now() - 86400e3)) {
          startDate = new Date();
        }
        const result = await mod.invokeRoutineManager({
          courseIds: routineCommandFound.courseIds,
          dailyHours: routineCommandFound.dailyHours,
          totalDays: routineCommandFound.totalDays,
          readingTime: routineCommandFound.readingTime,
          startDate,
          sessionId,
          userId,
        });
        summary = (result?.summary || "").trim() || "(routine created)";
      } catch (err) {
        logger.error(`[Agent] inline create_routine failed: ${err.message}`);
        summary = `❌ Routine toiri kora gelo na: ${err.message}`;
      }
      const durationMs = new Date() - startedAt;
      yield {
        type: "tool_result",
        toolCallId,
        toolName: "create_routine",
        content: summary,
        durationMs,
      };

      const { AIMessage } = await import("@langchain/core/messages");
      const aiMsg = new AIMessage({ content: summary });
      if (messageId) aiMsg.additional_kwargs = { messageId };
      await sessionCache.append(sessionId, aiMsg);

      yield {
        type: "end",
        content: summary,
        prompts: [],
        courseRefs: [],
        proposal: null,
      };
      logger.info(
        `[Agent] [CreateRoutine] intercepted from LLM output (${durationMs}ms)`,
      );
      return;
    }

    let cleanedText;
    let prompts;
    let courseRefs;
    let proposal;

    if (createCourseOutputs.length > 0) {
      // A course was generated this turn. Discard ALL model narration
      // (research dumps, roadmap recaps, etc.) and show ONLY the tool's
      // clean summary. The hidden ```course block becomes the preview card.
      const cr = extractCourseRefs(createCourseOutputs.join("\n\n"));
      cleanedText = cr.cleanedText.trim();
      courseRefs = cr.courseRefs;
      prompts = [];
      proposal = null;
    } else {
      // Extract structured clarifying-question prompts from the raw response
      const askResult = extractAskBlocks(fullResponse);
      // …then strip any course-ref blocks too
      const courseResult = extractCourseRefs(askResult.cleanedText);
      // …then strip the post-assessment course-proposal block
      const proposalResult = extractProposal(courseResult.cleanedText);
      cleanedText = proposalResult.cleanedText;
      prompts = askResult.prompts;
      courseRefs = courseResult.courseRefs;
      proposal = proposalResult.proposal;
    }

    // Save the (cleaned) assistant response + prompts to cache + MongoDB
    if (
      cleanedText ||
      (prompts && prompts.length) ||
      (proposal && proposal.courses && proposal.courses.length)
    ) {
      const { AIMessage } = await import("@langchain/core/messages");
      const aiMsg = new AIMessage({ content: cleanedText });
      const additional = {};
      if (prompts && prompts.length) additional.prompts = prompts;
      if (courseRefs && courseRefs.length) additional.courseRefs = courseRefs;
      if (proposal && proposal.courses && proposal.courses.length)
        additional.proposal = proposal;
      if (messageId) additional.messageId = messageId;
      if (Object.keys(additional).length > 0) {
        aiMsg.additional_kwargs = {
          ...(aiMsg.additional_kwargs || {}),
          ...additional,
        };
      }
      await sessionCache.append(sessionId, aiMsg);
    }

    // Signal stream completion (cleaned text + structured prompts + course refs)
    yield {
      type: "end",
      content: cleanedText,
      prompts,
      courseRefs,
      proposal,
    };

    logger.info(
      `[Agent] Response complete for session: ${sessionId} (${cleanedText.length} chars, ${prompts.length} prompts, ${courseRefs.length} courseRefs, ${proposal?.courses?.length || 0} proposed)`,
    );
  } catch (err) {
    logger.error(`[Agent] Error processing message:`, err.message);

    // Yield error event
    yield {
      type: "error",
      error: err.message,
    };
  }
}

// --- Invoke Chat Agent (Non-Streaming) ---
// Simple request/response for REST API use

export async function invokeChatAgentSync(
  sessionId,
  userMessage,
  options = {},
) {
  const chunks = [];

  for await (const chunk of invokeChatAgent(sessionId, userMessage, options)) {
    if (chunk.type === "token") {
      chunks.push(chunk.content);
    }
    if (chunk.type === "error") {
      throw new Error(chunk.error);
    }
  }

  return chunks.join("");
}

export default { createChatAgent, invokeChatAgent, invokeChatAgentSync };
