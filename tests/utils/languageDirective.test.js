// Unit tests for the language directive helper.

import test from "node:test";
import assert from "node:assert/strict";
import {
  languageDirective,
  preserveLanguageNote,
} from "../../src/utils/languageDirective.js";

test("English / unset / auto return empty (no behavior change)", () => {
  for (const v of ["", null, undefined, "English", "english", "EN", "auto", "default"]) {
    assert.equal(languageDirective(v), "", `expected empty for ${JSON.stringify(v)}`);
    assert.equal(preserveLanguageNote(v), "");
  }
});

test("non-English produces a directive naming the language", () => {
  const d = languageDirective("Bengali");
  assert.match(d, /Bengali/);
  assert.match(d, /Language \(MANDATORY\)/);
  // Must instruct keeping code/technical terms in English.
  assert.match(d, /English/);
  assert.match(d, /code/i);
});

test("Banglish is honored verbatim", () => {
  assert.match(languageDirective("Banglish"), /Banglish/);
});

test("preserveLanguageNote tells the enricher not to translate", () => {
  const n = preserveLanguageNote("Bengali");
  assert.match(n, /Bengali/);
  assert.match(n, /never translate/i);
});

test("whitespace is trimmed before the default check", () => {
  assert.equal(languageDirective("  english  "), "");
  assert.match(languageDirective("  Bengali  "), /Bengali/);
});
