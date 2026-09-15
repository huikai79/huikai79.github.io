#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  assertMarkdownBodySafe,
  markdownBodyIssues,
  notionDividerMarkdown
} from "./notion-markdown-contract.mjs";

assert.equal(notionDividerMarkdown(), "* * *", "Notion dividers must avoid Setext ambiguity");

assert.deepEqual(
  markdownBodyIssues("第一段\n---\n作者"),
  ["line 2: ambiguous Setext heading/thematic break after non-blank content"],
  "a raw dash separator after body text must fail closed"
);

assert.deepEqual(
  markdownBodyIssues("標題\n===\n正文"),
  ["line 2: ambiguous Setext heading/thematic break after non-blank content"],
  "Setext-style equals underline must fail closed"
);

assert.deepEqual(
  markdownBodyIssues("第一段\n\n---\n\n第二段"),
  [],
  "an explicit thematic break separated by blank lines is not ambiguous"
);

assert.deepEqual(
  markdownBodyIssues("第一段\n\n* * *\n\n第二段"),
  [],
  "the Notion divider representation must remain safe"
);

assert.deepEqual(
  markdownBodyIssues("[Brandon Sanderson](https://www.youtube.com/watch?v=-6HOdHEeosc)"),
  [],
  "ordinary YouTube hyperlinks must remain ordinary links"
);

assert.deepEqual(
  markdownBodyIssues("[Brandon Sanderson]({{< youtube -6HOdHEeosc >}})"),
  ["line 1: Hugo shortcode found inside a Markdown link destination"],
  "a shortcode inside a Markdown link destination must be rejected"
);

assert.deepEqual(
  markdownBodyIssues("```text\n正文\n---\n[demo]({{< youtube abcdefghijk >}})\n```"),
  [],
  "literal examples inside fenced code must not trigger the body contract"
);

assert.equal(
  assertMarkdownBodySafe("正文\n\n* * *\n\n作者", "fixture"),
  "正文\n\n* * *\n\n作者"
);
assert.throws(
  () => assertMarkdownBodySafe("正文\n---\n作者", "fixture"),
  /fixture produced unsafe Markdown.*ambiguous Setext/,
  "unsafe generated Markdown must stop synchronization"
);

console.log("Notion Markdown semantic contract verification: PASS");
