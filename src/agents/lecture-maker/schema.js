// ===========================================
// Lecture Output Schema
// Zod schema for structured lecture generation
// Lecture = title + summary + array of typed blocks
// Used with llm.withStructuredOutput()
// ===========================================

import { z } from "zod";

// ===========================================
// Block Schemas (one per type)
// ===========================================

// --- Heading Block ---

const headingBlockSchema = z.object({
  type: z.literal("heading"),
  data: z.object({
    level: z.number().min(1).max(4).describe("Heading level (1 = largest, 4 = smallest)"),
    content: z.string().describe("Heading text"),
  }),
});

// --- Text Block ---

const textBlockSchema = z.object({
  type: z.literal("text"),
  data: z.object({
    content: z
      .string()
      .describe("Markdown-formatted paragraph text (can include **bold**, *italic*, links, etc.)"),
  }),
});

// --- Code Block ---

const codeBlockSchema = z.object({
  type: z.literal("code"),
  data: z.object({
    language: z
      .string()
      .describe("Programming language identifier (e.g., 'python', 'javascript', 'bash')"),
    content: z.string().describe("The actual code"),
    caption: z.string().optional().describe("Optional caption explaining the code"),
  }),
});

// --- Image Block ---
// Note: We don't generate real images — provide a placeholder + description

const imageBlockSchema = z.object({
  type: z.literal("image"),
  data: z.object({
    placeholder_url: z
      .string()
      .optional()
      .describe("Empty string or placeholder URL — actual image will be added later"),
    alt: z.string().describe("Alt text for accessibility"),
    description: z
      .string()
      .describe(
        "What this image should depict — used later by an image generation/search tool to produce the actual image"
      ),
    caption: z.string().optional().describe("Optional caption shown below the image"),
  }),
});

// --- SVG Block ---
// LLM can generate actual SVG markup for diagrams, charts, simple illustrations

const svgBlockSchema = z.object({
  type: z.literal("svg"),
  data: z.object({
    content: z.string().describe("Valid SVG markup (e.g., '<svg ...>...</svg>')"),
    caption: z.string().optional().describe("Optional caption"),
  }),
});

// --- JSON Block ---
// For showing structured data examples

const jsonBlockSchema = z.object({
  type: z.literal("json"),
  data: z.object({
    title: z.string().optional().describe("Title for this JSON example"),
    content: z
      .string()
      .describe("Valid JSON content as a string (will be parsed by frontend)"),
    caption: z.string().optional(),
  }),
});

// --- List Block ---

const listBlockSchema = z.object({
  type: z.literal("list"),
  data: z.object({
    style: z.enum(["ordered", "unordered"]).describe("List style"),
    items: z.array(z.string()).describe("List items (markdown supported)"),
  }),
});

// --- Table Block ---

const tableBlockSchema = z.object({
  type: z.literal("table"),
  data: z.object({
    headers: z.array(z.string()).describe("Column headers"),
    rows: z.array(z.array(z.string())).describe("Rows of cells (each row matches headers length)"),
    caption: z.string().optional(),
  }),
});

// --- Quote Block ---

const quoteBlockSchema = z.object({
  type: z.literal("quote"),
  data: z.object({
    content: z.string().describe("The quoted text"),
    author: z.string().optional().describe("Quote attribution"),
  }),
});

// --- Callout Block (info/warning/tip boxes) ---

const calloutBlockSchema = z.object({
  type: z.literal("callout"),
  data: z.object({
    style: z
      .enum(["info", "tip", "warning", "danger", "success", "note"])
      .describe("Visual style of the callout"),
    title: z.string().optional().describe("Optional callout title"),
    content: z.string().describe("Callout body text (markdown supported)"),
  }),
});

// --- Divider Block ---

const dividerBlockSchema = z.object({
  type: z.literal("divider"),
  data: z.object({}).optional(),
});

// ===========================================
// Union of all block types
// ===========================================

const blockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  textBlockSchema,
  codeBlockSchema,
  imageBlockSchema,
  svgBlockSchema,
  jsonBlockSchema,
  listBlockSchema,
  tableBlockSchema,
  quoteBlockSchema,
  calloutBlockSchema,
  dividerBlockSchema,
]);

// ===========================================
// Main Lecture Schema
// ===========================================

export const lectureSchema = z.object({
  title: z.string().describe("Engaging lecture title"),
  summary: z
    .string()
    .describe("1–2 sentence summary of what this lecture covers"),
  estimated_duration_minutes: z
    .number()
    .describe("Approximate time to read/study this lecture in minutes"),
  blocks: z
    .array(blockSchema)
    .describe(
      "Ordered array of content blocks making up the lecture. Use a mix of headings, text, code, images, SVG, lists, callouts, etc. for an engaging multi-modal experience."
    ),
  sources: z
    .array(z.string())
    .describe("URLs or document titles cited in the lecture"),
});

export default lectureSchema;
