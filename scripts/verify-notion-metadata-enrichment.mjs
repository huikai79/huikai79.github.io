#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
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
  entryType: "文章"
});
const selected = selectMetadataAutofill({
  existing: { summary: "", category: "", entryType: "" },
  proposal
});
assert.equal(selected.updates.category, "創作");
assert.equal(selected.updates.entryType, "文章");
assert.ok(selected.updates.summary);

const preserveExisting = selectMetadataAutofill({
  existing: { summary: "既有摘要不得覆蓋", category: "生活", entryType: "札記" },
  proposal: {
    summary: "這是一段足夠長、但不應覆蓋既有值的測試摘要內容。",
    category: "科技",
    entryType: "紀錄"
  }
});
assert.deepEqual(preserveExisting.updates, {});

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

const enrichmentWorkflow = fs.readFileSync(".github/workflows/notion-metadata-enrichment.yml", "utf8");
assert.match(enrichmentWorkflow, /name: "Notion authoring metadata enrichment"/);
assert.match(enrichmentWorkflow, /cron: "\*\/15 \* \* \* \*"/);
assert.match(enrichmentWorkflow, /METADATA_ENRICHMENT_APPLY: "1"/);
assert.match(enrichmentWorkflow, /OPENAI_METADATA_MODEL: gpt-5\.6-luna/);
assert.ok(!enrichmentWorkflow.includes("METADATA_ENRICHMENT_MIN_CONFIDENCE"));
assert.match(enrichmentWorkflow, /node scripts\/enrich-notion-metadata\.mjs/);

const syncWorkflow = fs.readFileSync(".github/workflows/sync.yml", "utf8");
assert.ok(!syncWorkflow.includes("enrich-notion-metadata.mjs"), "production sync must not mutate Notion metadata");

const healthWorkflow = fs.readFileSync(".github/workflows/notion-publication-health.yml", "utf8");
assert.ok(!healthWorkflow.includes("enrich-notion-metadata.mjs"), "publication health must remain read-only");

const runtime = fs.readFileSync("scripts/enrich-notion-metadata.mjs", "utf8");
assert.match(runtime, /Visibility.*equals: "Test"/s);
assert.match(runtime, /status.*equals: "Published"/s);
assert.match(runtime, /state\.visibility !== "Test"/);
assert.ok(!runtime.includes('properties.Visibility'));
assert.ok(!runtime.includes('properties.status'));
assert.ok(!runtime.includes("confidence"));
assert.match(runtime, /translationSourceIds\.length/);
assert.match(runtime, /translationStatus !== "Source"/);

console.log("Notion staging metadata enrichment verification: PASS");
