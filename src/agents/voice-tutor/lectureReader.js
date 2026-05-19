// ===========================================
// Lecture Reader
// Converts lecture blocks into speech-friendly text
// Each block type gets a tailored spoken representation
// ===========================================

/**
 * Convert a single block into the text the TTS should speak.
 * For visual-only blocks (code, image, svg, json, table), the spoken text
 * directs attention to the screen instead of reading raw content.
 *
 * @param {Object} block  { type, data }
 * @returns {string}      Plain text for TTS
 */
export function blockToSpeech(block) {
  if (!block || !block.type) return "";

  const data = block.data || {};

  switch (block.type) {
    // --- Heading: top-level emphasizes, deeper levels lighter ---
    case "heading": {
      const level = data.level || 2;
      const content = (data.content || "").trim();
      if (!content) return "";
      if (level === 1) return `Chapter: ${content}.`;
      if (level === 2) return `Section: ${content}.`;
      return `${content}.`;
    }

    // --- Text: read as-is (frontend will strip markdown anyway) ---
    case "text":
      return stripMarkdown(data.content || "");

    // --- Code: don't read raw code aloud ---
    case "code": {
      const lang = data.language ? ` in ${data.language}` : "";
      const cap = data.caption ? ` ${data.caption}` : "";
      return `Here is a code example${lang} displayed on screen.${cap}`;
    }

    // --- Image: read description (alt text fallback) ---
    case "image": {
      const desc = (data.description || data.alt || "").trim();
      if (!desc) return "An image is displayed on screen.";
      return `An illustration on screen showing: ${desc}.`;
    }

    // --- SVG diagram ---
    case "svg": {
      const cap = data.caption ? `: ${data.caption}` : "";
      return `A diagram is displayed on screen${cap}.`;
    }

    // --- JSON example ---
    case "json": {
      const t = data.title ? ` titled ${data.title}` : "";
      return `A JSON example${t} is shown on screen.`;
    }

    // --- List: read items with numbering or bullets ---
    case "list": {
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) return "";
      if (data.style === "ordered") {
        return items
          .map((item, i) => `${ordinal(i + 1)}, ${stripMarkdown(item)}.`)
          .join(" ");
      }
      return items.map((item) => `${stripMarkdown(item)}.`).join(" ");
    }

    // --- Table: don't read whole table ---
    case "table": {
      const headerCount = (data.headers || []).length;
      const rowCount = (data.rows || []).length;
      return `A table with ${headerCount} columns and ${rowCount} rows is displayed on screen.`;
    }

    // --- Quote: read content + author ---
    case "quote": {
      const author = data.author ? ` Quote by ${data.author}.` : "";
      return `Quote: ${stripMarkdown(data.content || "")}.${author}`;
    }

    // --- Callout: emphasize the style ---
    case "callout": {
      const style = data.style || "note";
      const title = data.title ? ` ${data.title}.` : "";
      const labelMap = {
        info: "Important note",
        tip: "Tip",
        warning: "Warning",
        danger: "Caution",
        success: "Key point",
        note: "Note",
      };
      const label = labelMap[style] || "Note";
      return `${label}.${title} ${stripMarkdown(data.content || "")}`;
    }

    // --- Divider: short pause ---
    case "divider":
      return "..."; // ElevenLabs treats ellipsis as natural pause

    default:
      return "";
  }
}

/**
 * Convert lecture title + summary + blocks into an ordered array of
 * { blockIndex, text } items for TTS playback. The "blockIndex" represents
 * the position in the original blocks array (frontend uses this for highlight).
 * Skips empty text to avoid wasted TTS calls.
 *
 * @param {Object} lecture  Lecture document from MongoDB
 * @returns {Array<{blockIndex: number, text: string}>}
 */
export function lectureToSpeechPlan(lecture) {
  const plan = [];

  // --- Opening: title + summary as the "intro" ---
  if (lecture.title) {
    plan.push({ blockIndex: -2, text: `Today's lecture: ${lecture.title}.` });
  }
  if (lecture.summary) {
    plan.push({ blockIndex: -1, text: lecture.summary });
  }

  // --- Each block ---
  const blocks = lecture.blocks || [];
  for (let i = 0; i < blocks.length; i++) {
    const text = blockToSpeech(blocks[i]).trim();
    if (text.length > 0) {
      plan.push({ blockIndex: i, text });
    }
  }

  return plan;
}

// ===========================================
// Helpers
// ===========================================

/**
 * Strip basic markdown for cleaner TTS pronunciation.
 * Removes **bold**, *italic*, `code`, [link](url), headings, list markers.
 */
function stripMarkdown(text) {
  if (!text) return "";
  return String(text)
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ordinal number words for list items: 1 → "First", 2 → "Second", etc.
 */
function ordinal(n) {
  const words = [
    "First", "Second", "Third", "Fourth", "Fifth",
    "Sixth", "Seventh", "Eighth", "Ninth", "Tenth",
  ];
  return words[n - 1] || `Number ${n}`;
}

export default { blockToSpeech, lectureToSpeechPlan };
