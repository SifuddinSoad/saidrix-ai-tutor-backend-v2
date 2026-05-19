// Math Explainer — text blocks containing LaTeX equations.
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const input = d.content || ctx.seg.text || "";
  return runExplainer("math", input, ctx.seg.text);
}

export default { explain };
