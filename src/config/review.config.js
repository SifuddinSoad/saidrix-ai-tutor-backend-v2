// ===========================================
// Project Reviewer Config
// File filtering + size + batching limits for the code review agent.
// ===========================================

export const ALLOWED_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py",
  ".html", ".htm",
  ".css", ".scss", ".sass", ".less",
  ".json", ".yml", ".yaml",
  ".md",
  ".vue", ".svelte",
  ".go",
  ".java", ".kt",
  ".rb",
  ".php",
  ".c", ".h", ".cpp", ".hpp", ".cc",
  ".cs",
  ".rs",
  ".swift",
  ".sql",
  ".sh",
]);

export const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".venv", "venv", "__pycache__", ".cache", "coverage",
  ".turbo", ".parcel-cache", ".vite", "out", "target",
  ".idea", ".vscode", ".DS_Store",
]);

export const MAX_FILE_BYTES =
  Number(process.env.REVIEW_MAX_FILE_KB || 50) * 1024;

export const MAX_TOTAL_BYTES =
  Number(process.env.REVIEW_MAX_TOTAL_KB || 2048) * 1024;

export const BATCH_SIZE = Number(process.env.REVIEW_BATCH_SIZE || 8);

export const MAX_ZIP_BYTES =
  Number(process.env.REVIEW_MAX_ZIP_MB || 50) * 1024 * 1024;

export default {
  ALLOWED_EXTENSIONS,
  SKIP_DIRECTORIES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  BATCH_SIZE,
  MAX_ZIP_BYTES,
};
