// ===========================================
// Shared RAG Search Tool
// Queries the KnowledgeDoc collection via MongoDB text search.
//
// Lives in `shared/` (not chat/ or course-maker/) so BOTH the chat agent
// and the course-maker agent can import it without creating an import
// cycle (course-maker/tools.js already imports webSearchTool from
// chat/tools.js).
// ===========================================

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import KnowledgeDoc from "../../db/models/KnowledgeDoc.js";
import logger from "../../utils/logger.js";

// --- Helper: Format RAG results for the LLM ---

export function formatRagResults(docs) {
  return docs
    .map(
      (d, i) =>
        `[${i + 1}] ${d.title} (Subject: ${d.subject})\n` +
        `Source: ${d.source || "internal"}\n` +
        `Tags: ${(d.tags || []).join(", ")}\n` +
        `Content: ${d.content.slice(0, 1000)}${d.content.length > 1000 ? "..." : ""}\n`
    )
    .join("\n---\n");
}

export const ragSearchTool = tool(
  async ({ query, subject, limit = 5 }) => {
    try {
      logger.info(`[RAG] Searching for: "${query}" subject="${subject || "any"}"`);

      // Build the MongoDB query
      const mongoQuery = { $text: { $search: query } };
      if (subject) {
        mongoQuery.subject = subject;
      }

      // 1) Text search (optionally scoped to a subject) with relevance score
      const docs = await KnowledgeDoc.find(mongoQuery, {
        score: { $meta: "textScore" },
      })
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .lean();

      if (docs.length > 0) {
        return formatRagResults(docs);
      }

      // 2) Subject was too narrow / wrong → retry text-only (drop subject).
      //    Career profiles are stored under subjects like "Frontend
      //    Developer", so a query like "HTML" with subject:"HTML" finds
      //    nothing even though the HTML content lives inside those docs.
      if (subject) {
        const textOnly = await KnowledgeDoc.find(
          { $text: { $search: query } },
          { score: { $meta: "textScore" } }
        )
          .sort({ score: { $meta: "textScore" } })
          .limit(limit)
          .lean();

        if (textOnly.length > 0) {
          return formatRagResults(textOnly);
        }

        // 3) Last resort: any docs matching the subject string.
        const bySubject = await KnowledgeDoc.find({ subject })
          .limit(limit)
          .lean();
        if (bySubject.length > 0) {
          return formatRagResults(bySubject);
        }
      }

      return `No knowledge base documents found for "${query}"${
        subject ? ` (subject: ${subject})` : ""
      }`;
    } catch (err) {
      logger.error("[RAG] Error:", err.message);
      return `RAG search failed: ${err.message}`;
    }
  },
  {
    name: "rag_search",
    description:
      "Search the internal knowledge base of curated tech-career profiles (skills, sub-topics, roadmaps, resources). Prefer this over web search for trusted reference material. Pass rich query terms (e.g. 'HTML CSS frontend web development'). Usually OMIT subject — only set it to an EXACT career-profile name like 'Frontend Developer' or 'Data Scientist'.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Search terms — include the skill plus related career keywords (e.g. 'React frontend developer components hooks')"
        ),
      subject: z
        .string()
        .optional()
        .describe(
          "Optional EXACT career-profile name only (e.g. 'Frontend Developer', 'Data Scientist'). Omit for skill/topic queries."
        ),
      limit: z.number().optional().describe("Max number of docs to return (default 5)"),
    }),
  }
);

export default { ragSearchTool, formatRagResults };
