#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  COVER_ASPECT_RATIO,
  firstMarkdownImage,
  pageHasExplicitCover,
  plainBodyExcerpt,
  resolveCoverReadiness,
  semanticCoverBrief
} from "./notion-cover-contract.mjs";

assert.equal(pageHasExplicitCover({ cover: null }), false);
assert.equal(
  pageHasExplicitCover({ cover: { type: "external", external: { url: "https://example.com/cover.jpg" } } }),
  true
);
assert.equal(
  pageHasExplicitCover({ cover: { type: "file", file: { url: "https://example.com/file.png" } } }),
  true
);

assert.equal(firstMarkdownImage("No image here"), null);
assert.equal(
  firstMarkdownImage('Before\n![students](https://example.com/students.jpg "caption")\nAfter'),
  "https://example.com/students.jpg"
);
assert.equal(firstMarkdownImage("![local](image-01.png)"), "image-01.png");

assert.equal(
  plainBodyExcerpt("# Heading\n\nA [useful link](https://example.com) with **meaning**."),
  "Heading A useful link with meaning."
);

const explicit = resolveCoverReadiness({
  page: { cover: { type: "external", external: { url: "https://example.com/cover.jpg" } } },
  markdown: "![body](body.jpg)",
  candidate: { title: "Title" }
});
assert.equal(explicit.ready, true);
assert.equal(explicit.strategy, "notion-cover");
assert.equal(explicit.bodyImage, "body.jpg");
assert.equal(explicit.semanticBrief, null);

const body = resolveCoverReadiness({
  page: { cover: null },
  markdown: "Paragraph\n\n![prototype](prototype.png)",
  candidate: { title: "Title" }
});
assert.equal(body.ready, true);
assert.equal(body.strategy, "no-hero");
assert.equal(body.bodyImage, "prototype.png");
assert.equal(body.semanticBrief.aspectRatio, COVER_ASPECT_RATIO);
assert.match(body.semanticBrief.handoff, /may intentionally publish without a Hero image/);

const noImage = resolveCoverReadiness({
  page: { cover: null },
  markdown: "Students learn by building their own projects.",
  candidate: {
    title: "大學該如何培養創業者",
    summary: "讓學生透過自主專案建立創造能力。",
    category: "教育",
    entryType: "推薦／整理"
  }
});
assert.equal(noImage.ready, true);
assert.equal(noImage.strategy, "no-hero");
assert.equal(noImage.bodyImage, null);
assert.equal(noImage.semanticBrief.aspectRatio, COVER_ASPECT_RATIO);
assert.match(noImage.semanticBrief.visualDirection, /大學該如何培養創業者/);
assert.match(noImage.semanticBrief.bodyExcerpt, /Students learn by building/);

const brief = semanticCoverBrief(
  { title: "A", summary: "B", category: "C", entryType: "D" },
  "Body"
);
assert.equal(brief.aspectRatio, "16:9");
assert.equal(brief.requirements.length, 5);
assert.match(brief.handoff, /Optional editorial visual brief/);

console.log("Notion optional-Hero contract helpers: PASS");
