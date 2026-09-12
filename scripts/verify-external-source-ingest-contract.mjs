#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  extractArticleDocument,
  isPublicIpAddress,
  notionBlocksFromArticle,
  sourceHash,
  validateIngestionUrl
} from "./external-source-ingest-contract.mjs";

assert.equal(validateIngestionUrl("https://example.com/path#section").toString(), "https://example.com/path");
assert.equal(validateIngestionUrl("http://example.com/").protocol, "http:");
assert.throws(() => validateIngestionUrl("file:///etc/passwd"), /http or https/);
assert.throws(() => validateIngestionUrl("https://user:pass@example.com"), /credentials/);
assert.throws(() => validateIngestionUrl("http://localhost:3000"), /not public/);
assert.throws(() => validateIngestionUrl("http://127.0.0.1"), /non-public/);
assert.throws(() => validateIngestionUrl("http://10.0.0.1"), /non-public/);
assert.throws(() => validateIngestionUrl("http://192.168.1.5"), /non-public/);
assert.throws(() => validateIngestionUrl("http://169.254.169.254/latest/meta-data"), /non-public/);
assert.equal(isPublicIpAddress("8.8.8.8"), true);
assert.equal(isPublicIpAddress("1.1.1.1"), true);
assert.equal(isPublicIpAddress("172.16.0.1"), false);
assert.equal(isPublicIpAddress("100.64.1.1"), false);
assert.equal(isPublicIpAddress("::1"), false);
assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);

const html = `<!doctype html>
<html lang="en">
<head>
  <title>Fallback title</title>
  <meta property="og:title" content="A Better Article Title">
  <meta name="author" content="Example Author">
  <meta property="article:published_time" content="2026-09-01T12:30:00Z">
  <link rel="canonical" href="/essay">
</head>
<body>
  <nav>This navigation text should not be captured.</nav>
  <main>
    <article>
      <h1>A Better Article Title</h1>
      <p>This is the first substantial paragraph of an English article. It contains enough words to make the source useful for ingestion and translation while remaining deterministic for a regression test.</p>
      <h2>Second section</h2>
      <p>This is another substantial paragraph. It explains why the ingestion contract must keep the original source as the semantic source of truth, while extracting only the safe article body rather than menus, recommendations, advertising, or footer material.</p>
      <ul><li>First useful list item with additional explanatory words for extraction.</li><li>Second useful list item with additional explanatory words for extraction.</li></ul>
      <blockquote>A short quotation remains part of the article body.</blockquote>
      <pre>const preserved = true;</pre>
      <aside class="related-posts">Related posts should disappear.</aside>
    </article>
  </main>
  <footer>Footer text should not be captured.</footer>
</body>
</html>`;

const article = extractArticleDocument(html, "https://example.com/original?utm_source=test#x");
assert.equal(article.title, "A Better Article Title");
assert.equal(article.author, "Example Author");
assert.equal(article.publishedAt, "2026-09-01T12:30:00Z");
assert.equal(article.language, "en");
assert.equal(article.canonicalUrl, "https://example.com/essay");
assert.ok(article.textLength > 200);
assert.match(article.hash, /^[0-9a-f]{64}$/);
assert.deepEqual(
  article.blocks.map(block => block.type),
  ["heading_1", "paragraph", "heading_2", "paragraph", "bulleted_list_item", "bulleted_list_item", "quote", "code"]
);
assert.equal(article.blocks.some(block => /navigation|Footer|Related posts/.test(block.text)), false);

const notionBlocks = notionBlocksFromArticle(article.blocks);
assert.equal(notionBlocks[0].type, "heading_1");
assert.equal(notionBlocks.at(-1).type, "code");
assert.equal(notionBlocks.at(-1).code.language, "plain text");

const sameHash = sourceHash({ canonicalUrl: article.canonicalUrl, title: article.title, blocks: article.blocks });
assert.equal(sameHash, article.hash);
const changedHash = sourceHash({
  canonicalUrl: article.canonicalUrl,
  title: article.title,
  blocks: [...article.blocks, { type: "paragraph", text: "A materially changed source body." }]
});
assert.notEqual(changedHash, article.hash);

const fallbackHtml = `
<html>
<head><title>Fallback English Page</title></head>
<body><main>
<p>${"English prose for language detection and article extraction. ".repeat(12)}</p>
</main></body>
</html>`;
const fallback = extractArticleDocument(fallbackHtml, "https://example.org/post");
assert.equal(fallback.language, "en");
assert.equal(fallback.canonicalUrl, "https://example.org/post");

const chineseHtml = `
<html lang="zh-TW"><head><title>測試文章</title></head><body><article>
<p>${"這是一段測試內容，用來確認第一版外文攝取只支援英文來源。".repeat(15)}</p>
</article></body></html>`;
assert.throws(() => extractArticleDocument(chineseHtml, "https://example.com/zh"), /unsupported source language/);

const tooShort = `<html lang="en"><head><title>Short</title></head><body><article><p>Too short.</p></article></body></html>`;
assert.throws(() => extractArticleDocument(tooShort, "https://example.com/short"), /could not be identified|too short/);

const longText = "word ".repeat(900);
const longBlocks = notionBlocksFromArticle([{ type: "paragraph", text: longText }]);
assert.ok(longBlocks[0].paragraph.rich_text.length > 1);
assert.ok(longBlocks[0].paragraph.rich_text.every(item => item.text.content.length <= 1900));

console.log("external source ingestion contract: ok");
