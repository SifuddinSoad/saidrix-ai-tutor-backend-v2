// Code Explainer — walks a code block in its language.
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const lang = d.language || "code";
  const parts = [`Language: ${lang}`];
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  parts.push(`Code:\n${d.content || ""}`);
  return runExplainer("code", parts.join("\n"), ctx.seg.text);
}

export default { explain };
