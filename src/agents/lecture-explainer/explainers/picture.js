// Picture Explainer — explains image blocks (description-driven).
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const parts = [];
  if (d.description) parts.push(`Intended image content: ${d.description}`);
  if (d.alt) parts.push(`Alt text: ${d.alt}`);
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  const input = parts.join("\n");
  return runExplainer("picture", input, ctx.seg.text);
}

export default { explain };
