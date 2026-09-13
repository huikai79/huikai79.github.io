#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  approvedTranslationSourceSelection,
  normalizeTranslationSourcePageId
} from "./translation-source-selection-contract.mjs";

const id = "3d97a59e-0439-8057-9455-e319f5edd387";
assert.equal(normalizeTranslationSourcePageId(id), id);
assert.equal(normalizeTranslationSourcePageId(id.replaceAll("-", "")), id);
assert.equal(
  normalizeTranslationSourcePageId(`https://www.notion.so/Writing-Advice-${id.replaceAll("-", "")}`),
  id
);
assert.equal(
  normalizeTranslationSourcePageId(`https://app.notion.com/p/${id.replaceAll("-", "")}`),
  id
);
assert.equal(approvedTranslationSourceSelection({ requestedApply: false, rawSourcePageId: "" }), "");
assert.equal(approvedTranslationSourceSelection({ requestedApply: false, rawSourcePageId: id }), id);
assert.equal(approvedTranslationSourceSelection({ requestedApply: true, rawSourcePageId: id }), id);
assert.throws(
  () => approvedTranslationSourceSelection({ requestedApply: true, rawSourcePageId: "" }),
  /single Translation Source page ID is required/
);
assert.throws(
  () => normalizeTranslationSourcePageId("https://example.com/nope"),
  /Notion page ID or Notion page URL/
);
assert.throws(
  () => normalizeTranslationSourcePageId("not-a-page-id"),
  /Notion page ID or Notion page URL/
);
console.log("targeted translation approval contract: ok");
