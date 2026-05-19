// List Explainer — teaches a list as a coherent whole.
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const items = Array.isArray(d.items) ? d.items : [];
  const style = d.style === "ordered" ? "ordered" : "unordered";

  const numbered = items
    .map((it, i) => (style === "ordered" ? `${i + 1}. ${it}` : `- ${it}`))
    .join("\n");
  const input = `List style: ${style}\nItems:\n${numbered}`;
  return runExplainer("list", input, ctx.seg.text);
}

export default { explain };
