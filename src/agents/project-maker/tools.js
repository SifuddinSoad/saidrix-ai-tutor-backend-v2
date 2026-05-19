// ===========================================
// Project-Maker Agent Tools
// Reuses the shared RAG tool + the course-maker's Wikipedia tool
// + the chat agent's web_search tool. No new tools needed.
// ===========================================

import { webSearchTool } from "../chat/tools.js";
import { ragSearchTool } from "../shared/ragSearchTool.js";
import { wikipediaSearchTool } from "../course-maker/tools.js";

export { ragSearchTool, wikipediaSearchTool, webSearchTool };

export function getProjectMakerTools() {
  return [ragSearchTool, wikipediaSearchTool, webSearchTool];
}

export default { getProjectMakerTools, ragSearchTool, wikipediaSearchTool, webSearchTool };
