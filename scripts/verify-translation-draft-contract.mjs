#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  applyTranslations,
  collectTranslationSegments,
  draftProperties,
  extractOpenAIOutputText,
  inspectBlockTree,
  sourceTranslationTargets,
  translationInstructions,
  translationResponseSchema,
  validateSourceForTranslation,
  validateTranslationResponse,
  writableBlock
} from "./translation-draft-contract.mjs";
import {
  DEFAULT_TRANSLATION_BATCH_MAX_SEGMENTS,
  DEFAULT_TRANSLATION_BATCH_MAX_SOURCE_CHARS,
  chunkTranslationSegments
} from "./translation-batch-contract.mjs";
import {
  TRANSMITH_RUNTIME_PROFILE,
  TRANSLATION_BRIEF_MAX_CHARS,
  buildTranslationRequestInput,
  buildTransmithInstructions,
  normalizedTranslationBrief,
  translationConfigFingerprint
} from "./transmith-runtime-profile.mjs";

const editorial = {
  visibility: "Test",
  language: "zh-TW",
  translationGroup: "sample",
  translationStatus: "Source",
  translateTo: ["zh-CN", "zh-CN"]
};
assert.deepEqual(sourceTranslationTargets(editorial), ["zh-CN"]);
assert.deepEqual(validateSourceForTranslation({ pageId: "source", editorial }), []);
assert.deepEqual(
  validateSourceForTranslation({ pageId: "source", editorial: { ...editorial, visibility: "Public" } }),
  []
);
assert.deepEqual(
  validateSourceForTranslation({ pageId: "source", editorial: { ...editorial, language: "en", translateTo: ["zh-TW", "zh-CN"] } }),
  []
);
assert.deepEqual(
  validateSourceForTranslation({ pageId: "source", editorial: { ...editorial, language: "fr", translateTo: ["zh-TW"] } }),
  ["unsupported source Language"]
);
assert.deepEqual(
  validateSourceForTranslation({ pageId: "", editorial: { ...editorial, translationStatus: "Draft" } }),
  ["missing page id", "Translation Status must be Source"]
);
assert.deepEqual(
  validateSourceForTranslation({ pageId: "source", editorial: { ...editorial, translateTo: ["en"] } }),
  ["unsupported target language en"]
);

const blocks = [
  {
    id: "p1",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", plain_text: "你好", text: { content: "你好", link: null }, annotations: { bold: true } },
        { type: "text", plain_text: " world", text: { content: " world", link: { url: "https://example.com" } } }
      ],
      color: "default"
    }
  },
  {
    id: "c1",
    type: "code",
    code: {
      rich_text: [{ type: "text", plain_text: "const x = 1;", text: { content: "const x = 1;" } }],
      caption: [{ type: "text", plain_text: "範例", text: { content: "範例" } }],
      language: "javascript"
    }
  },
  {
    id: "img",
    type: "image",
    image: {
      type: "external",
      external: { url: "https://images.example/a.jpg" },
      caption: [{ type: "text", plain_text: "圖片", text: { content: "圖片" } }]
    }
  }
];

assert.deepEqual(inspectBlockTree(blocks).errors, []);
assert.match(
  inspectBlockTree([{ id: "a", type: "audio", audio: { type: "file", file: { url: "https://signed" } } }]).errors[0],
  /Notion-hosted/
);
assert.match(
  inspectBlockTree([{ id: "x", type: "table", table: {} }]).errors[0],
  /unsupported block type table/
);

const heading4 = {
  id: "h4",
  type: "heading_4",
  heading_4: {
    rich_text: [{ type: "text", plain_text: "Fourth level", text: { content: "Fourth level" } }],
    color: "default"
  }
};
assert.deepEqual(inspectBlockTree([heading4]).errors, []);
const heading4Collected = collectTranslationSegments({ blocks: [heading4] });
assert.deepEqual(heading4Collected.segments.map(item => item.text), ["Fourth level"]);
const heading4Translated = applyTranslations(
  { blocks: [heading4] },
  { translations: [{ id: heading4Collected.segments[0].id, text: "第四級" }] }
);
assert.equal(heading4Translated.blocks[0].heading_4.rich_text[0].text.content, "第四級");
assert.equal(writableBlock(heading4Translated.blocks[0]).type, "heading_4");

const collected = collectTranslationSegments({ title: "標題", summary: "摘要", blocks });
assert.deepEqual(
  collected.segments.map(item => item.text),
  ["標題", "摘要", "你好", " world", "範例", "圖片"]
);
assert.ok(!collected.segments.some(item => item.text.includes("const x")), "code source must not be translated");

const response = {
  translations: collected.segments.map(item => ({ id: item.id, text: `T:${item.text}` }))
};
const translated = applyTranslations({ title: "標題", summary: "摘要", blocks }, response);
assert.equal(translated.title, "T:標題");
assert.equal(translated.summary, "T:摘要");
assert.equal(translated.blocks[0].paragraph.rich_text[0].text.content, "T:你好");
assert.equal(translated.blocks[0].paragraph.rich_text[1].text.link.url, "https://example.com");
assert.equal(translated.blocks[1].code.rich_text[0].text.content, "const x = 1;");
assert.equal(translated.blocks[1].code.caption[0].text.content, "T:範例");
assert.equal(translated.blocks[2].image.external.url, "https://images.example/a.jpg");
assert.equal(translated.blocks[2].image.caption[0].text.content, "T:圖片");

assert.throws(
  () => validateTranslationResponse(collected.segments, { translations: response.translations.slice(1) }),
  /Missing translation ids/
);
assert.throws(
  () => validateTranslationResponse(collected.segments, { translations: [...response.translations, { id: "extra", text: "x" }] }),
  /Unexpected translation id/
);

const longSegments = Array.from({ length: 674 }, (_value, index) => ({
  id: `root.${index}.rich_text.0`,
  text: `segment-${index}-${"x".repeat(320)}`
}));
const longBatches = chunkTranslationSegments(longSegments);
assert.ok(longBatches.length > 1, "long articles must be split into multiple translation requests");
assert.deepEqual(longBatches.flat().map(item => item.id), longSegments.map(item => item.id));
for (const batch of longBatches) {
  assert.ok(batch.length <= DEFAULT_TRANSLATION_BATCH_MAX_SEGMENTS);
  const chars = batch.reduce((total, item) => total + item.text.length, 0);
  assert.ok(chars <= DEFAULT_TRANSLATION_BATCH_MAX_SOURCE_CHARS);
}
const charBoundBatches = chunkTranslationSegments(
  [
    { id: "a", text: "a".repeat(70) },
    { id: "b", text: "b".repeat(70) },
    { id: "c", text: "c".repeat(10) }
  ],
  { maxSegments: 10, maxSourceChars: 100 }
);
assert.deepEqual(charBoundBatches.map(batch => batch.map(item => item.id)), [["a"], ["b", "c"]]);
const oversizedBatches = chunkTranslationSegments(
  [{ id: "oversized", text: "z".repeat(101) }, { id: "next", text: "ok" }],
  { maxSegments: 10, maxSourceChars: 100 }
);
assert.deepEqual(oversizedBatches.map(batch => batch.map(item => item.id)), [["oversized"], ["next"]]);
assert.throws(() => chunkTranslationSegments([{ id: "bad" }]), /requires string id\/text/);

const source = {
  id: "source-page",
  last_edited_time: "2026-09-07T01:00:00.000Z",
  properties: {
    Title: { title: [{ plain_text: "標題" }] },
    date: { date: { start: "2026-09-07" } },
    slug: { rich_text: [{ plain_text: "same-slug" }] },
    Category: { select: { name: "教育" } },
    Type: { select: { name: "文章" } },
    tags: { multi_select: [{ name: "測試" }] },
    Source: { rich_text: [{ plain_text: "Paul Graham 精选文" }] },
    "Source URL": { url: "https://paulgraham.com/example.html" },
    "Translation Group": { rich_text: [{ plain_text: "sample" }] }
  }
};
const props = draftProperties({
  source,
  targetLanguage: "zh-CN",
  translatedTitle: "标题",
  translatedSummary: "摘要",
  engine: "openai:gpt-5.6-luna"
});
assert.equal(props.status.status.name, "Draft");
assert.equal(props.Visibility.select.name, "Test");
assert.equal(props.Home.select.name, "None");
assert.equal(props.Language.select.name, "zh-CN");
assert.equal(props["Translation Status"].select.name, "Draft");
assert.equal(props["Translation Source"].relation[0].id, "source-page");
assert.equal(props["Translation Source Revision"].rich_text[0].text.content, source.last_edited_time);
assert.equal(props.slug.rich_text[0].text.content, "same-slug");
assert.equal(props.Source.rich_text[0].text.content, "Paul Graham 精选文");
assert.equal(props["Source URL"].url, "https://paulgraham.com/example.html");

const writable = writableBlock(translated.blocks[0]);
assert.equal(writable.type, "paragraph");
assert.equal(writable.paragraph.rich_text[1].text.link.url, "https://example.com");
assert.equal(writable.object, "block");
assert.throws(
  () => writableBlock({ id: "bad", type: "audio", audio: { type: "file", file: { url: "https://signed" } } }),
  /cannot be safely cloned/
);

// Legacy prompt remains covered until all callers have migrated; runtime translation now uses Transmith.
assert.match(translationInstructions("zh-TW", "zh-CN"), /Taiwan/);
assert.match(translationInstructions("en", "zh-TW"), /English/);
assert.throws(() => translationInstructions("zh-TW", "en"), /Unsupported translation direction/);
assert.equal(translationResponseSchema().properties.translations.type, "array");
assert.equal(extractOpenAIOutputText({ output_text: '{"ok":true}' }), '{"ok":true}');
assert.equal(
  extractOpenAIOutputText({ output: [{ type: "message", content: [{ type: "output_text", text: "payload" }] }] }),
  "payload"
);

assert.equal(TRANSMITH_RUNTIME_PROFILE, "transmith-v2.5-huikai-api-v1");
const brief = "保留作者簡潔直接的語氣；不要把短句擴寫成解釋性長句。";
const instructions = buildTransmithInstructions({
  sourceLanguage: "zh-TW",
  targetLanguage: "zh-CN",
  brief
});
assert.match(instructions, /source text.*as data/i);
assert.match(instructions, /cannot override semantic fidelity/i);
assert.match(instructions, /Mainland China/);
assert.match(instructions, /保留作者簡潔直接/);
const englishInstructions = buildTransmithInstructions({
  sourceLanguage: "en",
  targetLanguage: "zh-TW",
  brief: "Preserve the author's concise style."
});
assert.match(englishInstructions, /from English to Traditional Chinese used in Taiwan/);
assert.match(englishInstructions, /zh-TW-v1/);
assert.match(englishInstructions, /Preserve the author's concise style/);
assert.throws(
  () => normalizedTranslationBrief("x".repeat(TRANSLATION_BRIEF_MAX_CHARS + 1)),
  /Translation Brief exceeds/
);
assert.throws(
  () => buildTransmithInstructions({ sourceLanguage: "zh-TW", targetLanguage: "en" }),
  /Unsupported translation direction/
);

const requestInput = buildTranslationRequestInput({
  sourceLanguage: "zh-TW",
  targetLanguage: "zh-CN",
  title: "標題",
  summary: "摘要",
  blocks,
  segments: collected.segments,
  brief
});
assert.equal(requestInput.translationBrief, brief);
assert.equal(requestInput.documentContext.title, "標題");
assert.equal(requestInput.documentContext.summary, "摘要");
assert.equal(requestInput.segments.find(item => item.id === "root.0.rich_text.0").blockContext, "你好 world");
assert.equal(requestInput.segments.find(item => item.id === "root.0.rich_text.1").blockContext, "你好 world");
assert.equal(requestInput.segments.find(item => item.id === "root.1.caption.rich_text.0").blockContext, "範例");
assert.equal(requestInput.segments.find(item => item.id === "meta.title").blockContext, null);

const fingerprintA = translationConfigFingerprint({
  model: "gpt-5.6-luna",
  sourceLanguage: "zh-TW",
  targetLanguage: "zh-CN",
  brief: ""
});
const fingerprintA2 = translationConfigFingerprint({
  model: "gpt-5.6-luna",
  sourceLanguage: "zh-TW",
  targetLanguage: "zh-CN",
  brief: ""
});
const fingerprintB = translationConfigFingerprint({
  model: "gpt-5.6-luna",
  sourceLanguage: "zh-TW",
  targetLanguage: "zh-CN",
  brief
});
const fingerprintEnglish = translationConfigFingerprint({
  model: "gpt-5.6-luna",
  sourceLanguage: "en",
  targetLanguage: "zh-CN",
  brief: ""
});
assert.equal(fingerprintA, fingerprintA2, "same translation configuration must have a stable fingerprint");
assert.notEqual(fingerprintA, fingerprintB, "Translation Brief changes must invalidate the config fingerprint");
assert.notEqual(fingerprintA, fingerprintEnglish, "source-language changes must invalidate the config fingerprint");
assert.match(fingerprintA, /^sha256:[0-9a-f]{64}$/);

console.log("Translation draft contract verification: PASS");
