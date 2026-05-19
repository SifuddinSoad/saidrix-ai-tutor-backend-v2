// ===========================================
// Course-Maker Agent Tools
// Wikipedia search + RAG search over KnowledgeDoc
// Also reuses web_search from chat agent
// ===========================================

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { webSearchTool } from "../chat/tools.js";
import { ragSearchTool } from "../shared/ragSearchTool.js";
import logger from "../../utils/logger.js";

export { ragSearchTool };

// ===========================================
// Wikipedia Search Tool
// Free API, no key required
// ===========================================

export const wikipediaSearchTool = tool(
  async ({ query, limit = 3 }) => {
    try {
      logger.info(`[Wikipedia] Searching for: "${query}"`);

      // Step 1: Search for matching article titles
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        query
      )}&format=json&srlimit=${limit}&origin=*`;

      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();

      const hits = searchData?.query?.search || [];
      if (hits.length === 0) {
        return `No Wikipedia results for "${query}"`;
      }

      // Step 2: Get summary/extract for each hit
      const results = [];
      for (const hit of hits) {
        const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(
          hit.title
        )}&format=json&origin=*`;

        const extractRes = await fetch(extractUrl);
        const extractData = await extractRes.json();

        const pages = extractData?.query?.pages || {};
        const page = Object.values(pages)[0];

        results.push({
          title: hit.title,
          summary: page?.extract?.slice(0, 800) || hit.snippet,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
        });
      }

      // Format results as readable text for the LLM
      return results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.summary}\n`
        )
        .join("\n---\n");
    } catch (err) {
      logger.error("[Wikipedia] Error:", err.message);
      return `Wikipedia search failed: ${err.message}`;
    }
  },
  {
    name: "wikipedia_search",
    description:
      "Search Wikipedia for foundational concepts, definitions, and overview information. Best for understanding what a topic is, its history, and core ideas.",
    schema: z.object({
      query: z.string().describe("The topic to search on Wikipedia"),
      limit: z
        .number()
        .optional()
        .describe("Max number of articles to return (default 3)"),
    }),
  }
);

// ===========================================
// Tool Registry
// (rag_search now lives in ../shared/ragSearchTool.js and is
//  re-exported above for back-compat with existing imports)
// ===========================================

export function getCourseMakerTools() {
  return [ragSearchTool, wikipediaSearchTool, webSearchTool];
}

export default { wikipediaSearchTool, ragSearchTool, getCourseMakerTools };
