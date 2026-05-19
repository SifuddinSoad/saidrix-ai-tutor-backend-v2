// ===========================================
// Q&A Prompts
// System prompt for in-lecture Q&A tutor persona
// ===========================================

/**
 * Build the system prompt for Q&A based on current lecture context.
 *
 * @param {Object} args
 * @param {Object} args.lecture           Lecture doc
 * @param {Object} args.currentBlock      Block currently being read (or just finished)
 * @param {Object[]} [args.recentBlocks]  1-2 previous blocks for context
 */
export function buildQASystemPrompt({ lecture, currentBlock, recentBlocks = [] }) {
  const title = lecture?.title || "current lecture";
  const summary = lecture?.summary || "";
  const topicName = lecture?.topic_name || "";

  // --- Recent context (max ~600 chars) ---
  const contextLines = [];
  if (currentBlock) {
    const cText = blockToContextText(currentBlock);
    if (cText) contextLines.push(`CURRENT: ${cText}`);
  }
  for (const b of recentBlocks) {
    const t = blockToContextText(b);
    if (t) contextLines.push(`RECENT: ${t}`);
  }
  const lectureContext = contextLines.join("\n").slice(0, 1500);

  return `You are an interactive voice tutor helping a student during a lecture they are listening to RIGHT NOW.

Lecture: "${title}"
Topic: ${topicName}
${summary ? `Summary: ${summary}` : ""}

What the student is currently studying:
${lectureContext || "(introduction)"}

The student has just spoken a question. Your reply will be spoken aloud via TTS.

Rules:
- Be conversational and brief (target 15–45 seconds of spoken audio, ~50–120 words).
- Use the lecture context to give a relevant, accurate answer.
- If the question is unrelated, gently redirect: "Great question — but let's stay focused on..."
- If the question is unclear, ask ONE short clarification.
- End with a brief invitation to continue: "Shall we continue?" / "Ready to move on?" / "Want me to keep going?"
- Respond in the SAME language the student used (Bengali, English, or mixed Banglish).
- Do NOT include markdown formatting, code fences, or special characters that don't speak well.
- Do NOT repeat the question — answer directly.`;
}

// ===========================================
// Helpers
// ===========================================

/**
 * Compress a block into a short textual summary used as Q&A context.
 */
function blockToContextText(block) {
  if (!block || !block.type) return "";
  const data = block.data || {};

  switch (block.type) {
    case "heading":
      return `[${data.level === 1 ? "Chapter" : "Section"}: ${data.content}]`;
    case "text":
      return (data.content || "").slice(0, 300);
    case "code":
      return `[Code example in ${data.language || "code"}: ${(data.content || "").slice(0, 200)}]`;
    case "image":
      return `[Image: ${data.description || data.alt || ""}]`;
    case "svg":
      return `[Diagram${data.caption ? ": " + data.caption : ""}]`;
    case "callout":
      return `[${data.style}: ${data.content}]`;
    case "list":
      return `[List: ${(data.items || []).slice(0, 3).join("; ")}]`;
    case "quote":
      return `[Quote: ${(data.content || "").slice(0, 200)}]`;
    case "json":
      return `[JSON example: ${data.title || ""}]`;
    case "table":
      return `[Table with columns: ${(data.headers || []).join(", ")}]`;
    default:
      return "";
  }
}

export default { buildQASystemPrompt };
