// Text Explainer — text blocks plus heading / quote / callout /
// divider, and the synthetic lecture intro & summary segments.
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const type = (block && block.type) || "text";
  const d = (block && block.data) || {};

  // Divider is just a beat — nothing to teach.
  if (type === "divider") return "...";

  let input;
  switch (type) {
    case "heading": {
      const lvl = d.level || 2;
      input = `This is a section heading (level ${lvl}): "${d.content || ""}". Briefly frame what this section covers and why it matters.`;
      break;
    }
    case "quote":
      input = `Quote: "${d.content || ""}"${d.author ? ` — ${d.author}` : ""}. Deliver it and explain its relevance.`;
      break;
    case "callout":
      input = `Callout (${d.style || "note"})${d.title ? ` titled "${d.title}"` : ""}: ${d.content || ""}`;
      break;
    default:
      // text block, or synthetic intro/summary (data.content = raw text)
      input = d.content || ctx.seg.text || "";
  }

  return runExplainer("text", input, ctx.seg.text);
}

export default { explain };
