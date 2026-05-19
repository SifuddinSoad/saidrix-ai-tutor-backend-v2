// ===========================================
// Lecture-Maker Agent Tools
// Reuses web_search (Tavily) and rag_search
// from chat/course-maker agents
// ===========================================

import { webSearchTool } from "../chat/tools.js";
import { ragSearchTool } from "../course-maker/tools.js";

// --- Get All Lecture-Maker Tools ---

export function getLectureMakerTools() {
  return [ragSearchTool, webSearchTool];
}

export default { getLectureMakerTools };
