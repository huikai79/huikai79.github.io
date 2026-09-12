#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildNotionFilter,
  contentFilename,
  editorialFrontMatter,
  extractEditorialFields,
  normalizeSyncMode,
  productionMetadataMissing,
  productionTranslationIssues,
  provenanceIssues,
  publicationRecordMissing,
  publicSlugChangeBlocked,
  shouldQuarantineDeletion,
  translationGovernanceIssues
} from "./notion-content-contract.mjs";
import {
  finalizeManifestPresentationFingerprints,
  notionPresentationFingerprint,
  prepareManifestForPresentationSync
} from "./notion-presentation-fingerprint.mjs";

assert.equal(normalizeSyncMode(undefined), "legacy");
assert.equal(normalizeSyncMode("PRODUCTION"), "production");
assert.throws(() => normalizeSyncMode("unsafe"), /NOTION_SYNC_MODE/);

const websiteLanguageFilter = {
  or: [
    { property: "Language", select: { equals: "zh-TW" } },
    { property: "Language", select: { equals: "zh-CN" } },
    { property: "Language", select: { is_empty: true } }
  ]
};

assert.deepEqual(buildNotionFilter("legacy"), {
  and: [
    { property: "status", status: { equals: "Published" } },
    websiteLanguageFilter
  ]
});

assert.deepEqual(buildNotionFilter("production"), {
  and: [
    { property: "status", status: { equals: "Published" } },
    { property: "Visibility", select: { equals: "Public" } },
    websiteLanguageFilter
  ]
});

assert.deepEqual(buildNotionFilter("preview"), {
  and: [
    { property: "status", status: { equals: "Published" } },
    {
      or: [
        { property: "Visibility", select: { equals: "Public" } },
        { property: "Visibility", select: { equals: "Test" } }
      ]
    },
    websiteLanguageFilter
  ]
});

const fields = extractEditorialFields({
  Visibility: { select: { name: "Public" } },
  Category: { select: { name: "AI 與數位工具" } },
  Type: { select: { name: "實驗紀錄" } },
  Summary: { rich_text: [{ plain_text: "摘要" }] },
  Home: { select: { name: "Rotation" } },
  Language: { select: { name: "zh-TW" } },
  Source: { rich_text: [{ plain_text: "Paul Graham 精选文" }] },
  "Source URL": { url: "https://paulgraham.com/example.html" },
  "Translation Group": { rich_text: [{ plain_text: "example-article" }] },
  "Translate To": { multi_select: [{ name: "zh-CN" }] },
  "Translation Status": { select: { name: "Source" } },
  "Translation Source": { relation: [] },
  "Translation Source Revision": { rich_text: [] },
  "Translation Engine": { rich_text: [] }
});
assert.deepEqual(fields, {
  visibility: "Public",
  category: "AI 與數位工具",
  entryType: "實驗紀錄",
  summary: "摘要",
  homePlacement: "Rotation",
  language: "zh-TW",
  source: "Paul Graham 精选文",
  sourceUrl: "https://paulgraham.com/example.html",
  translationGroup: "example-article",
  translateTo: ["zh-CN"],
  translationStatus: "Source",
  translationSourceIds: [],
  translationSourceRevision: "",
  translationEngine: ""
});

assert.deepEqual(provenanceIssues({ source: "", sourceUrl: "" }), []);
assert.deepEqual(provenanceIssues({ source: "Source", sourceUrl: "https://example.com" }), []);
assert.deepEqual(provenanceIssues({ source: "Source", sourceUrl: "" }), ["Source URL"]);
assert.deepEqual(provenanceIssues({ source: "", sourceUrl: "https://example.com" }), ["Source"]);

assert.deepEqual(
  productionMetadataMissing({
    visibility: "Public",
    summary: "摘要",
    category: "教育",
    entryType: "文章",
    language: "zh-CN",
    source: "",
    sourceUrl: "",
    translationGroup: "article-key",
    translationStatus: "Source"
  }),
  []
);
assert.deepEqual(
  productionMetadataMissing({
    visibility: "Test",
    summary: "",
    category: "",
    entryType: "",
    language: "",
    source: "",
    sourceUrl: "",
    translationGroup: "",
    translationStatus: ""
  }),
  ["Visibility=Public", "Summary", "Category", "Type", "Language", "Translation Group", "Translation Status"]
);
assert.deepEqual(
  productionMetadataMissing({
    visibility: "Public",
    summary: "摘要",
    category: "教育",
    entryType: "文章",
    language: "en",
    source: "",
    sourceUrl: "",
    translationGroup: "article-key",
    translationStatus: "Source"
  }),
  ["Language=en"]
);
assert.deepEqual(
  productionMetadataMissing({
    visibility: "Public",
    summary: "摘要",
    category: "教育",
    entryType: "文章",
    language: "zh-TW",
    source: "Imported essay",
    sourceUrl: "",
    translationGroup: "article-key",
    translationStatus: "Source"
  }),
  ["Source URL"]
);

const sourceTranslation = {
  visibility: "Public",
  language: "zh-TW",
  translationStatus: "Source",
  translateTo: ["zh-CN"],
  translationSourceIds: [],
  translationSourceRevision: "",
  translationEngine: ""
};
assert.deepEqual(translationGovernanceIssues(sourceTranslation), []);
assert.deepEqual(productionTranslationIssues(sourceTranslation), []);
assert.deepEqual(
  translationGovernanceIssues({ ...sourceTranslation, language: "en", translateTo: ["zh-TW", "zh-CN"] }),
  []
);
assert.deepEqual(
  translationGovernanceIssues({ ...sourceTranslation, language: "fr", translateTo: ["zh-TW"] }),
  ["Source Language=fr"]
);
assert.deepEqual(
  translationGovernanceIssues({ ...sourceTranslation, translateTo: ["en"] }),
  ["Translate To=en"]
);
assert.deepEqual(
  translationGovernanceIssues({ ...sourceTranslation, translateTo: ["zh-TW"] }),
  ["Translate To includes source language zh-TW"]
);
assert.deepEqual(
  translationGovernanceIssues({ ...sourceTranslation, translationSourceIds: ["source-id"] }),
  ["Source article must not have Translation Source"]
);

const approvedTranslation = {
  visibility: "Public",
  language: "zh-CN",
  translationStatus: "Approved",
  translateTo: [],
  translationSourceIds: ["source-id"],
  translationSourceRevision: "2026-09-07T00:00:00.000Z",
  translationEngine: "openai:gpt-5.6-luna"
};
assert.deepEqual(translationGovernanceIssues(approvedTranslation), []);
assert.deepEqual(productionTranslationIssues(approvedTranslation), []);
assert.deepEqual(
  translationGovernanceIssues({ ...approvedTranslation, language: "en" }),
  ["Translated Language=en"]
);
assert.deepEqual(
  productionTranslationIssues({ ...approvedTranslation, translationStatus: "Review" }),
  ["Public translation lifecycle requires Source or Approved; found Review"]
);
assert.deepEqual(
  translationGovernanceIssues({
    ...approvedTranslation,
    translationSourceIds: [],
    translationSourceRevision: "",
    translationEngine: ""
  }),
  ["Translated article requires exactly one Translation Source", "Translation Source Revision", "Translation Engine"]
);

const publicationCandidate = {
  title: "大學該如何培養創業者",
  slug: "daxuepeiyangchuangyezhe",
  date: "2026-09-06",
  visibility: "Public",
  summary: "摘要",
  category: "教育",
  entryType: "推薦／整理",
  homePlacement: "None",
  language: "zh-TW",
  source: "Paul Graham 精选文",
  sourceUrl: "https://paulgraham.com/prepare.html",
  translationGroup: "daxuepeiyangchuangyezhe",
  translationStatus: "Source",
  translateTo: [],
  translationSourceIds: [],
  translationSourceRevision: "",
  translationEngine: ""
};
assert.deepEqual(publicationRecordMissing(publicationCandidate), []);
assert.deepEqual(publicationRecordMissing({ ...publicationCandidate, date: "" }), ["date"]);
assert.deepEqual(editorialFrontMatter(publicationCandidate), {
  description: "摘要",
  categories: ["教育"],
  entryType: "推薦／整理",
  contentVisibility: "Public",
  homePlacement: "None",
  contentLanguage: "zh-TW",
  translationKey: "daxuepeiyangchuangyezhe",
  sourceLabel: "Paul Graham 精选文",
  sourceURL: "https://paulgraham.com/prepare.html"
});
assert.throws(
  () => editorialFrontMatter({ ...publicationCandidate, summary: "" }),
  /Summary/
);
assert.throws(
  () => editorialFrontMatter({ ...publicationCandidate, translationStatus: "Review" }),
  /Source or Approved/
);
assert.equal(contentFilename("zh-TW"), "index.md");
assert.equal(contentFilename("zh-CN"), "index.zh-cn.md");
assert.throws(() => contentFilename("en"), /Unsupported content language/);
assert.throws(() => contentFilename("fr"), /Unsupported content language/);

assert.equal(
  shouldQuarantineDeletion({ previousCount: 80, deletedCount: 15 }),
  true
);
assert.equal(
  shouldQuarantineDeletion({ previousCount: 14, deletedCount: 3 }),
  true
);
assert.equal(
  shouldQuarantineDeletion({ previousCount: 14, deletedCount: 1 }),
  false
);
assert.equal(
  shouldQuarantineDeletion({ previousCount: 0, deletedCount: 10 }),
  false
);

assert.equal(
  publicSlugChangeBlocked(
    { visibility: "Public", slug: "old" },
    { visibility: "Public", slug: "new" }
  ),
  true
);
assert.equal(
  publicSlugChangeBlocked(
    { visibility: "Test", slug: "old" },
    { visibility: "Public", slug: "new" }
  ),
  false
);
assert.equal(
  publicSlugChangeBlocked(
    { visibility: "Public", slug: "old" },
    { visibility: "Public", slug: "new" },
    true
  ),
  false
);

const externalCoverA = {
  cover: { type: "external", external: { url: "https://images.example/a.jpg?fit=crop&w=1600" } },
  icon: null
};
const externalCoverB = {
  cover: { type: "external", external: { url: "https://images.example/b.jpg?fit=crop&w=1600" } },
  icon: null
};
assert.notEqual(
  notionPresentationFingerprint(externalCoverA),
  notionPresentationFingerprint(externalCoverB)
);

const signedFileA = {
  cover: { type: "file", file: { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/asset.jpg?X-Amz-Signature=one" } },
  icon: null
};
const signedFileB = {
  cover: { type: "file", file: { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/asset.jpg?X-Amz-Signature=two" } },
  icon: null
};
assert.equal(
  notionPresentationFingerprint(signedFileA),
  notionPresentationFingerprint(signedFileB)
);

const fpA = notionPresentationFingerprint(externalCoverA);
const fpB = notionPresentationFingerprint(externalCoverB);
const prepared = prepareManifestForPresentationSync(
  {
    version: 1,
    pages: {
      pageA: { slug: "a", presentationFingerprint: fpA, bundleHash: "hash-a" },
      pageB: { slug: "b", presentationFingerprint: fpA, bundleHash: "hash-b" },
      deletedPage: { slug: "deleted", presentationFingerprint: fpA, bundleHash: "hash-c" }
    }
  },
  [
    { pageId: "pageA", presentationFingerprint: fpA },
    { pageId: "pageB", presentationFingerprint: fpB }
  ]
);
assert.deepEqual(prepared.invalidated, ["pageB"]);
assert.equal(prepared.manifest.pages.pageA.slug, "a");
assert.equal(prepared.manifest.pages.pageB, undefined);
assert.equal(prepared.manifest.pages.deletedPage.slug, "deleted");

const finalized = finalizeManifestPresentationFingerprints(
  {
    version: 1,
    pages: {
      pageA: { slug: "a", bundleHash: "hash-a" },
      pageB: { slug: "b", bundleHash: "hash-b" }
    }
  },
  [
    { pageId: "pageA", presentationFingerprint: fpA },
    { pageId: "pageB", presentationFingerprint: fpB },
    { pageId: "missing", presentationFingerprint: fpB }
  ]
);
assert.deepEqual(finalized.applied, ["pageA", "pageB"]);
assert.equal(finalized.manifest.pages.pageA.presentationFingerprint, fpA);
assert.equal(finalized.manifest.pages.pageB.presentationFingerprint, fpB);

console.log("Notion content contract verification: PASS");
