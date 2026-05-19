// JSON Explainer — explains the shape and meaning of a JSON example.
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const parts = [];
  if (d.title) parts.push(`Title: ${d.title}`);
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  parts.push(`JSON:\n${d.content || ""}`);
  return runExplainer("json", parts.join("\n"), ctx.seg.text);
}

export default { explain };
