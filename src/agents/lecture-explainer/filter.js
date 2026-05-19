// ===========================================
// Block Filter
// Routes each lecture block to the explainer agent
// responsible for its type. A text block that carries
// significant LaTeX is routed to the math explainer
// (there is no dedicated "math" block type in the schema).
// ===========================================

// LaTeX delimiters: $$...$$, \[...\], \(...\), inline $...$, \begin{env}
const LATEX_RE =
  /(\$\$[\s\S]+?\$\$)|(\\\[[\s\S]+?\\\])|(\\\([\s\S]+?\\\))|(\$[^$\n]+\$)|(\\begin\{[a-zA-Z*]+\})/;

/**
 * True if the text contains LaTeX-style math worth routing to the
 * math explainer.
 * @param {string} text
 * @returns {boolean}
 */
export function detectMath(text) {
  if (!text || typeof text !== "string") return false;
  return LATEX_RE.test(text);
}

/**
 * Decide which explainer key handles a given block.
 * Keys map 1:1 to modules in ./explainers/.
 *
 * @param {Object} block  { type, data }
 * @returns {string}      explainer key
 */
export function filterBlock(block) {
  if (!block || !block.type) return "text";

  const data = block.data || {};

  switch (block.type) {
    case "image":
      return "picture";
    case "code":
      return "code";
    case "svg":
      return "diagram";
    case "table":
      return "table";
    case "list":
      return "list";
    case "json":
      return "json";
    case "text":
      return detectMath(data.content) ? "math" : "text";

    // A heading is just a section title — running it through the deep
    // explainer turns it into a chatty paragraph. Route it straight to
    // the enhancer (handled specially in the orchestrator).
    case "heading":
      return "heading";

    // quote / callout / divider — narrative, handled by text
    case "quote":
    case "callout":
    case "divider":
      return "text";

    default:
      return "text";
  }
}

export default { filterBlock, detectMath };
