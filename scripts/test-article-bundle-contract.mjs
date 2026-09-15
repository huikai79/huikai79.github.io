#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  assignArticleBundlePaths,
  manifestBundlePath
} from "./article-bundle-contract.mjs";

const single = assignArticleBundlePaths([
  {
    pageId: "source",
    slug: "humility",
    language: "zh-TW",
    translationGroup: "humility",
    translationStatus: "Source"
  }
]);
assert.equal(single.get("source"), "humility");

const family = assignArticleBundlePaths([
  {
    pageId: "source",
    slug: "humility",
    language: "zh-TW",
    translationGroup: "humility",
    translationStatus: "Source"
  },
  {
    pageId: "cn",
    slug: "humility",
    language: "zh-CN",
    translationGroup: "humility",
    translationStatus: "Approved"
  },
  {
    pageId: "en",
    slug: "humility",
    language: "en",
    translationGroup: "humility",
    translationStatus: "Approved"
  }
]);
assert.deepEqual(Object.fromEntries(family), {
  source: "humility",
  cn: "humility--zh-cn",
  en: "humility--en"
});

const externalSourceFamily = assignArticleBundlePaths([
  {
    pageId: "tw",
    slug: "writing-advice",
    language: "zh-TW",
    translationGroup: "chadnauseam-writing-advice",
    translationStatus: "Approved"
  },
  {
    pageId: "cn",
    slug: "writing-advice",
    language: "zh-CN",
    translationGroup: "chadnauseam-writing-advice",
    translationStatus: "Approved"
  }
]);
assert.deepEqual(Object.fromEntries(externalSourceFamily), {
  tw: "writing-advice",
  cn: "writing-advice--zh-cn"
});

assert.throws(
  () => assignArticleBundlePaths([
    { pageId: "a", slug: "same", language: "zh-TW", translationGroup: "a", translationStatus: "Source" },
    { pageId: "b", slug: "same", language: "zh-CN", translationGroup: "b", translationStatus: "Approved" }
  ]),
  /one non-empty Translation Group/
);

assert.throws(
  () => assignArticleBundlePaths([
    { pageId: "a", slug: "same", language: "zh-TW", translationGroup: "same", translationStatus: "Source" },
    { pageId: "b", slug: "same", language: "zh-TW", translationGroup: "same", translationStatus: "Approved" }
  ]),
  /duplicate language\/slug route/
);

assert.throws(
  () => assignArticleBundlePaths([
    { pageId: "a", slug: "same", language: "zh-TW", translationGroup: "same", translationStatus: "Source" },
    { pageId: "b", slug: "same", language: "zh-CN", translationGroup: "same", translationStatus: "Source" }
  ]),
  /at most one in-scope canonical Source/
);

assert.throws(
  () => assignArticleBundlePaths([
    { pageId: "a", slug: "same", language: "zh-TW", translationGroup: "same", translationStatus: "Approved" },
    { pageId: "b", slug: "same", language: "zh-CN", translationGroup: "same", translationStatus: "Draft" }
  ]),
  /not an Approved-only translated family/
);

assert.equal(manifestBundlePath({ slug: "legacy" }), "legacy");
assert.equal(manifestBundlePath({ slug: "public", bundlePath: "public--en" }), "public--en");
assert.throws(() => manifestBundlePath({ slug: "x", bundlePath: "../x" }), /unsafe bundle path/);

console.log("Article bundle contract tests: PASS");
