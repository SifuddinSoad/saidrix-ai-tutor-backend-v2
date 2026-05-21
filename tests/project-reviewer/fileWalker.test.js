// Unit tests for project-reviewer/fileWalker.
// Verifies the filter rules: skip-dirs honoured, binaries rejected,
// per-file size cap truncates, only allowed extensions included.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { walkAndFilter } from "../../src/agents/project-reviewer/fileWalker.js";
import { MAX_FILE_BYTES } from "../../src/config/review.config.js";

function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, c) { fs.writeFileSync(p, c); }

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fw-"));
  // Reviewable
  mkdir(path.join(root, "src"));
  write(path.join(root, "src", "app.js"), "console.log(1);\nconsole.log(2);\n");
  write(path.join(root, "README.md"), "# hello\n");
  // Skipped dir
  mkdir(path.join(root, "node_modules", "foo"));
  write(path.join(root, "node_modules", "foo", "ignored.js"), "x");
  // Disallowed extension
  write(path.join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // Binary with allowed ext (null bytes → rejected)
  write(path.join(root, "binary.js"), Buffer.from([0, 1, 2, 3, 0, 0]));
  // Oversize file → should be truncated, not skipped
  const big = "a".repeat(MAX_FILE_BYTES * 2);
  write(path.join(root, "big.js"), big);
  return root;
}

test("walkAndFilter respects skip directories and extensions", () => {
  const root = makeTree();
  try {
    const { files, stats } = walkAndFilter(root);
    const paths = files.map((f) => f.path).sort();
    assert.ok(paths.includes("src/app.js"));
    assert.ok(paths.includes("README.md"));
    assert.ok(!paths.some((p) => p.startsWith("node_modules")), "node_modules must be skipped");
    assert.ok(!paths.includes("image.png"), "binary extension must be filtered");
    assert.ok(!paths.includes("binary.js"), "binary content must be filtered");
    assert.ok(stats.reviewedFiles >= 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("walkAndFilter truncates oversized files instead of skipping", () => {
  const root = makeTree();
  try {
    const { files } = walkAndFilter(root);
    const big = files.find((f) => f.path === "big.js");
    assert.ok(big, "big.js should be included");
    assert.ok(big.bytes <= MAX_FILE_BYTES, "big.js content must be truncated");
    assert.equal(big.truncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
