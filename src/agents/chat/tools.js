// ===========================================
// Chat Agent Tools
// Tool definitions for the chat agent
// Includes web search and custom tool support
// ===========================================

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ragSearchTool } from "../shared/ragSearchTool.js";
import logger from "../../utils/logger.js";

// --- Tool Registry ---
// Stores all registered custom tools

const customTools = [];

// --- Lazy import for course-maker (avoids circular dependency) ---
let _invokeCourseMaker = null;
async function getInvokeCourseMaker() {
  if (!_invokeCourseMaker) {
    const mod = await import("../course-maker/graph.js");
    _invokeCourseMaker = mod.invokeCourseMaker;
  }
  return _invokeCourseMaker;
}

// ===========================================
// Built-in Tools
// ===========================================

// --- Web Search Tool ---
// Searches the internet via Tavily API
// Tavily is optimized for AI agents — returns clean, summarized results

export const webSearchTool = tool(
  async ({ query, maxResults = 5, searchDepth = "basic" }) => {
    try {
      logger.info(`[Web Search] Querying Tavily for: "${query}"`);

      // Tavily API endpoint
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        return "Web search unavailable: TAVILY_API_KEY not set in environment.";
      }

      // Call Tavily search API (Bearer auth)
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: searchDepth, // "basic" or "advanced"
          include_answer: true,
          max_results: maxResults,
        }),
      });

      // Handle non-200 responses
      if (!res.ok) {
        const errText = await res.text();
        logger.error(`[Web Search] Tavily error ${res.status}:`, errText.slice(0, 200));
        return `Web search failed (HTTP ${res.status}): ${errText.slice(0, 200)}`;
      }

      const data = await res.json();

      // Format the results for the LLM
      const parts = [];

      // Tavily's auto-generated answer summary (very useful)
      if (data.answer) {
        parts.push(`**Quick Answer**: ${data.answer}`);
      }

      // Individual search results
      if (Array.isArray(data.results) && data.results.length > 0) {
        const formatted = data.results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content?.slice(0, 500) || ""}`
          )
          .join("\n\n---\n\n");
        parts.push(`**Search Results**:\n\n${formatted}`);
      } else {
        parts.push(`No web results for "${query}"`);
      }

      return parts.join("\n\n");
    } catch (err) {
      logger.error("[Web Search] Error:", err.message);
      return `Web search failed: ${err.message}`;
    }
  },
  {
    name: "web_search",
    description:
      "Search the web for current information using Tavily. Use this when you need up-to-date data, news, facts, tutorials, or any information that might have changed recently.",
    schema: z.object({
      query: z.string().describe("The search query to look up on the web"),
      maxResults: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default 5)"),
      searchDepth: z
        .enum(["basic", "advanced"])
        .optional()
        .describe("'basic' for fast results, 'advanced' for deeper analysis (slower)"),
    }),
  }
);

// ===========================================
// List-My-Courses Tool
// Used by the chat agent at the START of a routine flow so it can show
// the user their actual courses (by title) to pick from. Reads userId
// from the RunnableConfig that chat/graph.js passes per invocation.
// ===========================================

function countTopics(course) {
  let n = 0;
  for (const ch of course.chapters || [])
    for (const mod of ch.modules || [])
      for (const sm of mod.sub_modules || [])
        n += (sm.topics || []).length;
  return n;
}

export const listMyCoursesTool = tool(
  async (_input, config) => {
    try {
      const userId =
        config?.configurable?.userId ||
        config?.metadata?.userId;
      if (!userId) {
        return "ERROR: no userId in tool config (cannot list courses).";
      }
      const Course = (await import("../../db/models/Course.js")).default;
      const courses = await Course.find({ userId })
        .select("courseId course_title chapters createdAt")
        .sort({ createdAt: -1 })
        .lean();
      if (!courses.length) {
        return "The user has no courses yet. Tell them in one sentence to create a course first before making a routine.";
      }
      const out = courses.map((c) => ({
        courseId: c.courseId,
        title: c.course_title,
        topicCount: countTopics(c),
      }));
      logger.info(`[list_my_courses] Returned ${out.length} courses for user ${userId}`);
      return JSON.stringify(out);
    } catch (err) {
      logger.error("[list_my_courses] Error:", err.message);
      return `Failed to list courses: ${err.message}`;
    }
  },
  {
    name: "list_my_courses",
    description:
      "List the current user's existing courses (courseId, title, topicCount). Call this FIRST when the user asks for a routine / study plan, so you can offer them their real courses as options. Takes no arguments.",
    schema: z.object({}),
  }
);

// ===========================================
// Course-Maker Tool
// Bridges chat agent to course-maker agent
// ===========================================

export const createCourseTool = tool(
  async (input) => {
    try {
      logger.info(`[create_course] Invoked for topic: "${input.topic}"`);

      const invokeCourseMaker = await getInvokeCourseMaker();
      const result = await invokeCourseMaker(input);

      // Append a fenced `course-ref` block carrying the structured
      // courseId so the chat agent can pass it through to the frontend,
      // which renders an interactive drill-down preview.
      const summary = result.summary || "";
      const ref = `\n\n\`\`\`course\n${JSON.stringify({ courseId: result.courseId })}\n\`\`\``;
      return summary + ref;
    } catch (err) {
      logger.error("[create_course] Error:", err.message);
      return `Failed to create course: ${err.message}`;
    }
  },
  {
    name: "create_course",
    description:
      "Generate a structured learning course on a specific topic. Use this ONLY AFTER you have asked the user clarifying questions about their skill level, learning goals, time available, and preferences. The course will be researched from a knowledge base, Wikipedia, and the web, then saved to the database.",
    schema: z.object({
      topic: z
        .string()
        .describe("The subject the user wants to learn (e.g., 'LangChain', 'React Hooks')"),
      level: z
        .enum(["beginner", "intermediate", "advanced"])
        .describe("Learner's current skill level"),
      goals: z
        .string()
        .describe("Specific learning goals — what the user wants to achieve"),
      duration: z
        .string()
        .optional()
        .describe("Time available to complete the course (e.g., '2 weeks', '10 hours')"),
      preferences: z
        .string()
        .optional()
        .describe("Learning preferences (videos vs reading, project-based, etc.)"),
      language: z
        .string()
        .optional()
        .describe(
          "The language the user is writing/speaking in — set this so the course, its lectures, and the voice tutor are all generated in that language (e.g. 'Bengali', 'English', 'Banglish'). Defaults to English if omitted."
        ),
      sessionId: z
        .string()
        .optional()
        .describe("Chat session ID for linking the course (provided by system if available)"),
    }),
  }
);

// ===========================================
// Custom Tool Support
// ===========================================

// --- Create Custom Tool ---
// Factory function for creating user-defined tools
// config: { name, description, schema (zod), handler (async function) }

export function createCustomTool(config) {
  const { name, description, schema, handler } = config;

  const newTool = tool(
    async (input) => {
      try {
        logger.info(`[Tool: ${name}] Executing with input:`, input);
        const result = await handler(input);
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        logger.error(`[Tool: ${name}] Error:`, err.message);
        return `Tool "${name}" failed: ${err.message}`;
      }
    },
    {
      name,
      description,
      schema,
    }
  );

  // Add to registry
  customTools.push(newTool);
  logger.info(`[Tools] Registered custom tool: "${name}"`);

  return newTool;
}

// --- Get All Tools ---
// Returns the complete list of tools (built-in + custom)

export function getTools() {
  return [webSearchTool, ragSearchTool, createCourseTool, listMyCoursesTool, ...customTools];
}

export default { webSearchTool, ragSearchTool, createCourseTool, listMyCoursesTool, createCustomTool, getTools };
