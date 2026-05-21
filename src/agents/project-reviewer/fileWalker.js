// ===========================================
// File Walker
// Recursively reads a directory, applies the review filter (extension
// whitelist + skip-dir blacklist + size caps), and returns the
// reviewable file set. Pure, unit-testable.
// ===========================================

import fs from "fs";
import path from "path";
import {
  ALLOWED_EXTENSIONS,
  SKIP_DIRECTORIES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from "../../config/review.config.js";

function isBinary(buf) {
  // Heuristic: a null byte in the first 8KB is almost always binary.
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) if (buf[i] === 0) return true;
  return false;
}

export function walkAndFilter(rootDir) {
  const files = [];
  let totalFiles = 0;
  let skipped = 0;
  let bytesUsed = 0;

  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        walk(abs, relPath);
        continue;
      }
      if (!entry.isFile()) continue;

      totalFiles++;
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        skipped++;
        continue;
      }

      let stat;
      try { stat = fs.statSync(abs); } catch { skipped++; continue; }

      if (stat.size === 0) { skipped++; continue; }
      if (bytesUsed >= MAX_TOTAL_BYTES) { skipped++; continue; }

      let buf;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        skipped++;
        continue;
      }
      if (isBinary(buf)) { skipped++; continue; }

      // Per-file cap: truncate rather than skip so giant minified files
      // still contribute their first lines to the review.
      let truncated = false;
      if (buf.length > MAX_FILE_BYTES) {
        buf = buf.subarray(0, MAX_FILE_BYTES);
        truncated = true;
      }
      // Total cap: stop adding when the next file would exceed the
      // overall budget.
      if (bytesUsed + buf.length > MAX_TOTAL_BYTES) {
        const remaining = MAX_TOTAL_BYTES - bytesUsed;
        if (remaining <= 0) { skipped++; continue; }
        buf = buf.subarray(0, remaining);
        truncated = true;
      }

      const content = buf.toString("utf8");
      const lineCount = content.split(/\r?\n/).length;
      bytesUsed += buf.length;

      files.push({
        path: relPath,
        content,
        lineCount,
        bytes: buf.length,
        truncated,
      });
    }
  }

  walk(rootDir, "");
  return {
    files,
    stats: {
      totalFiles,
      reviewedFiles: files.length,
      skippedFiles: skipped,
      totalLines: files.reduce((sum, f) => sum + f.lineCount, 0),
      bytesUsed,
    },
  };
}

export default { walkAndFilter };
