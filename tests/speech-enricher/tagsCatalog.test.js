// ===========================================
// Tests: tagsCatalog helpers
// ===========================================

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TAGS,
  TAG_RE,
  isAllowedTag,
  stripTags,
} from "../../src/agents/speech-enricher/tagsCatalog.js";

test("ALLOWED_TAGS includes common emotions", () => {
  for (const tag of ["surprised", "excited", "whispers", "laughs", "sighs"]) {
    assert.ok(ALLOWED_TAGS.includes(tag), `missing ${tag}`);
  }
});

test("isAllowedTag accepts known tags case-insensitively", () => {
  assert.equal(isAllowedTag("[excited]"), true);
  assert.equal(isAllowedTag("[EXCITED]"), true);
  assert.equal(isAllowedTag("[  whispers  ]"), true);
});

test("isAllowedTag rejects unknown tags", () => {
  assert.equal(isAllowedTag("[ninja]"), false);
  assert.equal(isAllowedTag(""), false);
  assert.equal(isAllowedTag(null), false);
});

test("TAG_RE matches all tags in a sentence", () => {
  const text = "[excited] Hello [whispers] world [pause] end";
  const tags = text.match(TAG_RE);
  assert.deepEqual(tags, ["[excited]", "[whispers]", "[pause]"]);
});

test("stripTags removes all tags and normalizes whitespace", () => {
  assert.equal(
    stripTags("[excited] Hello [whispers] world"),
    "Hello world"
  );
  assert.equal(stripTags("[pause]   end"), "end");
  assert.equal(stripTags(""), "");
});
