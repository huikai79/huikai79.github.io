#!/usr/bin/env node
import assert from "node:assert/strict";
import { productionMetadataMissing } from "./notion-content-contract.mjs";
import {
  TRANSLATION_SUMMARY_MAX_CHARS,
  buildTranslationCandidateFilter,
  deriveTranslationSummary,
  effectiveTranslationSummary,
  translationDraftProperties,
  translationReadinessIssues
} from "./translation-readiness-contract.mjs";

assert.deepEqual(buildTranslationCandidateFilter(""), {
  property: "Translate To",
  multi_select: { is_not_empty: true }
});
assert.deepEqual(buildTranslationCandidateFilter("writing-advice"), {
  and: [
    { property: "Translate To", multi_select: { is_not_empty: true } },
    { property: "Translation Group", rich_text: { equals: "writing-advice" } }
  ]
});

const draftEditorial = {
  visibility: "",
  language: "en",
  translationGroup: "writing-advice",
  translationStatus: "Source",
  translateTo: ["zh-TW", "zh-CN"]
};
assert.deepEqual(
  translationReadinessIssues({ pageId: "source", title: "Writing Advice", editorial: draftEditorial }),
  []
);
assert.deepEqual(
  translationReadinessIssues({
    pageId: "source",
    title: "Same language",
    editorial: { ...draftEditorial, language: "zh-TW", translateTo: ["zh-TW"] }
  }),
  ["Translate To includes source language zh-TW"]
);
assert.deepEqual(
  translationReadinessIssues({
    pageId: "source",
    title: "Unsupported",
    editorial: { ...draftEditorial, language: "fr", translateTo: ["zh-TW"] }
  }),
  ["unsupported source Language"]
);
assert.deepEqual(
  translationReadinessIssues({
    pageId: "source",
    title: "No group",
    editorial: { ...draftEditorial, translationGroup: "" }
  }),
  ["missing Translation Group"]
);

const blocks = [
  {
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", plain_text: "First   paragraph.", text: { content: "First   paragraph." } }]
    }
  },
  {
    type: "code",
    code: {
      rich_text: [{ type: "text", plain_text: "const secret = true;", text: { content: "const secret = true;" } }],
      caption: [{ type: "text", plain_text: "Code example", text: { content: "Code example" } }]
    }
  },
  {
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: [{ type: "text", plain_text: "Second point", text: { content: "Second point" } }]
    }
  }
];

assert.equal(deriveTranslationSummary(blocks), "First paragraph. Code example Second point");
assert.ok(!deriveTranslationSummary(blocks).includes("secret"), "code body must not leak into derived summary");
assert.deepEqual(effectiveTranslationSummary("  Manual   summary  ", blocks), {
  summary: "Manual summary",
  source: "explicit"
});
assert.deepEqual(effectiveTranslationSummary("", blocks), {
  summary: "First paragraph. Code example Second point",
  source: "derived"
});
const longSummary = deriveTranslationSummary([
  {
    type: "paragraph",
    paragraph: {
      rich_text: [{
        type: "text",
        plain_text: "字".repeat(TRANSLATION_SUMMARY_MAX_CHARS + 5),
        text: { content: "字".repeat(TRANSLATION_SUMMARY_MAX_CHARS + 5) }
      }]
    }
  }
]);
assert.equal([...longSummary].length, TRANSLATION_SUMMARY_MAX_CHARS + 1);
assert.ok(longSummary.endsWith("…"));

const minimalSource = {
  id: "source-page",
  last_edited_time: "2026-09-12T12:00:00.000Z",
  properties: {}
};
const minimalProps = translationDraftProperties({
  source: minimalSource,
  group: "writing-advice",
  targetLanguage: "zh-TW",
  translatedTitle: "寫作建議",
  translatedSummary: "從正文衍生的摘要",
  engine: "openai:gpt-5.6-luna"
});
assert.equal(minimalProps.status.status.name, "Draft");
assert.equal(minimalProps.Visibility.select.name, "Test");
assert.equal(minimalProps.Language.select.name, "zh-TW");
assert.equal(minimalProps["Translation Status"].select.name, "Draft");
assert.equal(minimalProps["Translation Source"].relation[0].id, "source-page");
assert.equal(minimalProps["Translation Group"].rich_text[0].text.content, "writing-advice");
assert.ok(!("date" in minimalProps));
assert.ok(!("slug" in minimalProps));
assert.ok(!("Category" in minimalProps));
assert.ok(!("Type" in minimalProps));

const fullSource = {
  ...minimalSource,
  properties: {
    date: { date: { start: "2026-09-12" } },
    slug: { rich_text: [{ plain_text: "writing-advice" }] },
    Category: { select: { name: "學習" } },
    Type: { select: { name: "文章" } },
    tags: { multi_select: [{ name: "寫作" }] },
    Source: { rich_text: [{ plain_text: "Example Author" }] },
    "Source URL": { url: "https://example.com/writing" }
  }
};
const inherited = translationDraftProperties({
  source: fullSource,
  group: "writing-advice",
  targetLanguage: "zh-CN",
  translatedTitle: "写作建议",
  translatedSummary: "摘要",
  engine: "openai:gpt-5.6-luna"
});
assert.equal(inherited.date.date.start, "2026-09-12");
assert.equal(inherited.slug.rich_text[0].text.content, "writing-advice");
assert.equal(inherited.Category.select.name, "學習");
assert.equal(inherited.Type.select.name, "文章");
assert.equal(inherited.tags.multi_select[0].name, "寫作");
assert.equal(inherited.Source.rich_text[0].text.content, "Example Author");
assert.equal(inherited["Source URL"].url, "https://example.com/writing");

assert.deepEqual(
  productionMetadataMissing({
    visibility: "Public",
    summary: "",
    category: "教育",
    entryType: "文章",
    language: "zh-TW",
    source: "",
    sourceUrl: "",
    translationGroup: "article-key",
    translationStatus: "Source"
  }),
  ["Summary"]
);

console.log("Translation readiness contract verification: PASS");
