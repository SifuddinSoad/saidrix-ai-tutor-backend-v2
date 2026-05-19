// Diagram Explainer — reads raw SVG markup, explains the concept.
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const parts = [];
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  parts.push(`SVG markup:\n${d.content || ""}`);
  return runExplainer("diagram", parts.join("\n"), ctx.seg.text);
}

export default { explain };
