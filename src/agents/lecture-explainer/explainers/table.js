// Table Explainer — explains a table's structure and meaning.
import { runExplainer } from "./_base.js";

export async function explain(block, ctx) {
  const d = (block && block.data) || {};
  const headers = Array.isArray(d.headers) ? d.headers : [];
  const rows = Array.isArray(d.rows) ? d.rows : [];

  const parts = [];
  if (d.caption) parts.push(`Caption: ${d.caption}`);
  parts.push(`Columns: ${headers.join(" | ")}`);
  parts.push(
    `Rows:\n${rows.map((r) => (Array.isArray(r) ? r.join(" | ") : String(r))).join("\n")}`
  );
  return runExplainer("table", parts.join("\n"), ctx.seg.text);
}

export default { explain };
