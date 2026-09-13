#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  DEFAULT_AUTO_TRANSLATION_MAX_GENERATED,
  MAX_AUTO_TRANSLATION_MAX_GENERATED,
  automaticTranslationCandidateFilter,
  automaticTranslationFatalBlockers,
  automaticTranslationMaxGenerated,
  sortAutomaticTranslationSources
} from "./translation-auto-contract.mjs";

assert.deepEqual(automaticTranslationCandidateFilter(), {
  and: [
    { property: "Translate To", multi_select: { is_not_empty: true } },
    { property: "Translation Status", select: { equals: "Source" } },
    { property: "status", status: { equals: "Published" } },
    { property: "Visibility", select: { equals: "Public" } }
  ]
});

assert.equal(automaticTranslationMaxGenerated(""), DEFAULT_AUTO_TRANSLATION_MAX_GENERATED);
assert.equal(automaticTranslationMaxGenerated("1"), 1);
assert.equal(automaticTranslationMaxGenerated(String(MAX_AUTO_TRANSLATION_MAX_GENERATED)), MAX_AUTO_TRANSLATION_MAX_GENERATED);
assert.throws(() => automaticTranslationMaxGenerated("0"), /between 1 and/);
assert.throws(() => automaticTranslationMaxGenerated("6"), /between 1 and/);
assert.throws(() => automaticTranslationMaxGenerated("2.5"), /positive integer/);

const sorted = sortAutomaticTranslationSources([
  { id: "b", last_edited_time: "2026-09-13T02:00:00.000Z" },
  { id: "c", last_edited_time: "2026-09-13T01:00:00.000Z" },
  { id: "a", last_edited_time: "2026-09-13T02:00:00.000Z" }
]);
assert.deepEqual(sorted.map(item => item.id), ["c", "a", "b"]);

assert.deepEqual(
  automaticTranslationFatalBlockers([
    { fatal: false, reasons: ["unsupported block"] },
    { fatal: true, reasons: ["Notion write failed"] }
  ]),
  [{ fatal: true, reasons: ["Notion write failed"] }]
);

console.log("Automatic translation queue contract verification: PASS");
