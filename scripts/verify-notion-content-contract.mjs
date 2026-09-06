#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildNotionFilter,
  editorialFrontMatter,
  extractEditorialFields,
  normalizeSyncMode,
  productionMetadataMissing,
  publicationRecordMissing,
  publicSlugChangeBlocked,
  shouldQuarantineDeletion
} from "./notion-content-contract.mjs";
import {
  finalizeManifestPresentationFingerprints,
  notionPresentationFingerprint,
  prepareManifestForPresentationSync
} from "./notion-presentation-fingerprint.mjs";

assert.equal(normalizeSyncMode(undefined), "legacy");
assert.equal(normalizeSyncMode("PRODUCTION"), "production");
assert.throws(() => normalizeSyncMode("unsafe"), /NOTION_SYNC_MODE/);

assert.deepEqual(buildNotionFilter("legacy"), {
  property: "status",
  status: { equals: "Published" }
});

assert.deepEqual(buildNotionFilter("production"), {
  and: [
    { property: "status", status: { equals: "Published" } },
    { property: "Visibility", select: { equals: "Public" } }
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
    }
  ]
});

const fields = extractEditorialFields({
  Visibility: { select: { name: "Public" } },
  Category: { select: { name: "AI 與數位工具" } },
  Type: { select: { name: "實驗紀錄" } },
  Summary: { rich_text: [{ plain_text: "摘要" }] },
  Home: { select: { name: "Rotation" } }
});
assert.deepEqual(fields, {
  visibility: "Public",
  category: "AI 與數位工具",
  entryType: "實驗紀錄",
  summary: "摘要",
  homePlacement: "Rotation"
});

assert.deepEqual(
  productionMetadataMissing({
    visibility: "Public",
    summary: "摘要",
    category: "教育",
    entryType: "文章"
  }),
  []
);
assert.deepEqual(
  productionMetadataMissing({
    visibility: "Test",
    summary: "",
    category: "",
    entryType: ""
  }),
  ["Visibility=Public", "Summary", "Category", "Type"]
);

const publicationCandidate = {
  title: "大學該如何培養創業者",
  slug: "daxuepeiyangchuangyezhe",
  date: "2026-09-06",
  visibility: "Public",
  summary: "摘要",
  category: "教育",
  entryType: "推薦／整理",
  homePlacement: "None"
};
assert.deepEqual(publicationRecordMissing(publicationCandidate), []);
assert.deepEqual(publicationRecordMissing({ ...publicationCandidate, date: "" }), ["date"]);
assert.deepEqual(editorialFrontMatter(publicationCandidate), {
  description: "摘要",
  categories: ["教育"],
  entryType: "推薦／整理",
  contentVisibility: "Public",
  homePlacement: "None"
});
assert.throws(
  () => editorialFrontMatter({ ...publicationCandidate, summary: "" }),
  /Summary/
);

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