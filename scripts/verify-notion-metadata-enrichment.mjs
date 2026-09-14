#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_METADATA_CONFIDENCE_THRESHOLD,
  aiMetadataMissing,
  articleExcerpt,
  buildDeterministicMetadata,
  notionPropertiesFromMetadataUpdates,
  selectMetadataAutofill,
  sourceLabelFromUrl,
  validateMetadataProposal
} from "./notion-metadata-enrichment-contract.mjs";

assert.equal(sourceLabelFromUrl("https://www.penanginstitute.org/path?q=1"), "penanginstitute.org");
assert.equal(sourceLabelFromUrl("javascript:alert(1)"), "");
assert.deepEqual(
  buildDeterministicMetadata({
    slug: "hello-world",
    translationGroup: "",
    translationStatus: "",
    translationSourceIds: [],
    source: "",
    sourceUrl: "https://note.com/example"
  }),
  {
    translationGroup: "hello-world",
    translationStatus: "Source",
    source: "note.com"
  }
);
assert.deepEqual(
  buildDeterministicMetadata({
    slug: "translated",
    translationStatus: "Approved",
    translationSourceIds: ["source-page"],
    sourceUrl: "https://example.com"
  }),
  {}
);
assert.deepEqual(aiMetadataMissing({ summary: "", category: "創作", entryType: "" }), ["summary", "entryType"]);

const proposal = validateMetadataProposal({
  summary: "這是一段足夠長、可作為文章列表與搜尋描述使用的測試摘要。",
  category: "創作",
  categoryConfidence: 0.91,
  entryType: "文章",
  typeConfidence: 0.93
});
const selected = selectMetadataAutofill({
  existing: { summary: "", category: "", entryType: "" },
  proposal,
  threshold: DEFAULT_METADATA_CONFIDENCE_THRESHOLD
});
assert.equal(selected.updates.category, "創作");
assert.equal(selected.updates.entryType, "文章");
assert.ok(selected.updates.summary);

const lowConfidence = selectMetadataAutofill({
  existing: { summary: "既有摘要不得覆蓋", category: "", entryType: "" },
  proposal: {
    ...proposal,
    category: "科技",
    categoryConfidence: 0.4,
    entryType: "紀錄",
    typeConfidence: 0.5
  },
  threshold: 0.78
});
assert.equal(lowConfidence.updates.summary, undefined);
assert.equal(lowConfidence.updates.category, undefined);
assert.equal(lowConfidence.updates.entryType, undefined);
assert.equal(lowConfidence.held.length, 2);

const props = notionPropertiesFromMetadataUpdates({
  summary: proposal.summary,
  category: "創作",
  entryType: "文章",
  source: "example.com",
  translationGroup: "group-key",
  translationStatus: "Source"
});
assert.deepEqual(Object.keys(props).sort(), ["Category", "Source", "Summary", "Translation Group", "Translation Status", "Type"].sort());
assert.throws(() => notionPropertiesFromMetadataUpdates({ visibility: "Public" }), /unsupported metadata update key/);

const excerpt = articleExcerpt("a".repeat(20000), 16000);
assert.ok(excerpt.length <= 16030);
assert.match(excerpt, /中段省略/);

for (const workflowPath of [
  ".github/workflows/notion-publication-health.yml",
  ".github/workflows/sync.yml"
]) {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  const enrichIndex = workflow.indexOf("node scripts/enrich-notion-metadata.mjs");
  const contractIndex = workflow.indexOf("node scripts/check-notion-publication-contract.mjs");
  assert.ok(enrichIndex >= 0, `${workflowPath} must run metadata enrichment`);
  assert.ok(contractIndex > enrichIndex, `${workflowPath} must enrich metadata before publication contract`);
  assert.match(workflow, /METADATA_ENRICHMENT_APPLY: "1"/);
  assert.match(workflow, /OPENAI_METADATA_MODEL: gpt-5\.6-luna/);
}

const runtime = fs.readFileSync("scripts/enrich-notion-metadata.mjs", "utf8");
assert.ok(!runtime.includes('properties.Visibility'));
assert.ok(!runtime.includes('properties.status'));
assert.match(runtime, /translationSourceIds\.length/);
assert.match(runtime, /translationStatus !== "Source"/);

console.log("Notion metadata enrichment verification: PASS");
