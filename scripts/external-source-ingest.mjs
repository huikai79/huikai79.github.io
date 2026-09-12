#!/usr/bin/env node
import { Client } from "@notionhq/client";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import {
  INGESTION_STATUS,
  MAX_HTML_BYTES,
  MAX_INGESTION_REDIRECTS,
  extractArticleDocument,
  isPublicIpAddress,
  notionBlocksFromArticle,
  validateIngestionUrl
} from "./external-source-ingest-contract.mjs";
import { buildExternalIngestionCandidateFilter } from "./external-source-inbox-contract.mjs";

const token = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;
const reportPath = process.env.INGESTION_REPORT_PATH || "/tmp/external-source-ingest.json";
const timeoutMs = Number(process.env.INGESTION_TIMEOUT_MS || 15000);

if (!token) throw new Error("NOTION_TOKEN 未設定");
if (!databaseId) throw new Error("NOTION_DATABASE_ID 未設定");

const notion = new Client({ auth: token });

function titleValue(properties = {}) {
  return properties.Title?.title?.map(item => item.plain_text).join("").trim() ?? "";
}

function safeText(value, max = 1800) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function notionText(content) {
  return content ? [{ type: "text", text: { content: safeText(content, 1900) } }] : [];
}

function validDateStart(value) {
  if (!value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

async function queryAll(filter) {
  const results = [];
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter,
      page_size: 100,
      start_cursor: cursor
    });
    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function pendingCandidates() {
  return queryAll(buildExternalIngestionCandidateFilter());
}

async function pageHasMaterialChildren(pageId) {
  const response = await notion.blocks.children.list({ block_id: pageId, page_size: 10 });
  return response.results.some(block => {
    const data = block?.[block.type];
    if (Array.isArray(data?.rich_text)) {
      return data.rich_text.some(item => String(item.plain_text || "").trim());
    }
    return true;
  });
}

async function resolvePublicAddress(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (!isPublicIpAddress(hostname)) throw new Error("Source URL resolves to a non-public address");
    return { address: hostname, family: hostname.includes(":") ? 6 : 4 };
  }
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!answers.length) throw new Error("Source hostname did not resolve");
  const rejected = answers.filter(answer => !isPublicIpAddress(answer.address));
  if (rejected.length) throw new Error("Source hostname resolves to a non-public address");
  return answers[0];
}

function requestHtmlOnce(url, pinnedAddress) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const request = transport.request(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "HUIKAI-External-Reading-Ingestion/1.0 (+https://huikai79.github.io/)",
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Encoding": "identity"
      },
      lookup(_hostname, _options, callback) {
        callback(null, pinnedAddress.address, pinnedAddress.family);
      }
    }, response => {
      const status = response.statusCode || 0;
      const headers = response.headers;
      if (status >= 300 && status < 400 && headers.location) {
        response.resume();
        clearTimeout(timer);
        resolve({ status, headers, redirect: headers.location, html: "" });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        clearTimeout(timer);
        reject(new Error(`source fetch returned HTTP ${status}`));
        return;
      }
      const contentType = String(headers["content-type"] || "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        response.resume();
        clearTimeout(timer);
        reject(new Error(`unsupported source content-type: ${contentType || "missing"}`));
        return;
      }
      const declaredLength = Number(headers["content-length"] || 0);
      if (declaredLength > MAX_HTML_BYTES) {
        response.resume();
        clearTimeout(timer);
        reject(new Error("source response exceeds maximum HTML size"));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_HTML_BYTES) {
          request.destroy(new Error("source response exceeds maximum HTML size"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        clearTimeout(timer);
        resolve({
          status,
          headers,
          redirect: "",
          html: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.on("error", error => {
      clearTimeout(timer);
      reject(error.name === "AbortError" ? new Error("source fetch timed out") : error);
    });
    request.end();
  });
}

async function fetchArticleHtml(rawUrl) {
  let current = validateIngestionUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_INGESTION_REDIRECTS; redirectCount += 1) {
    const pinnedAddress = await resolvePublicAddress(current.hostname);
    const response = await requestHtmlOnce(current, pinnedAddress);
    if (!response.redirect) return { url: current.toString(), html: response.html };
    if (redirectCount === MAX_INGESTION_REDIRECTS) throw new Error("source exceeded redirect limit");
    current = validateIngestionUrl(new URL(response.redirect, current).toString());
  }
  throw new Error("source exceeded redirect limit");
}

async function findDuplicates(pageId, canonicalUrl, hash) {
  const matches = await queryAll({
    or: [
      { property: "Canonical URL", url: { equals: canonicalUrl } },
      { property: "Source Hash", rich_text: { equals: hash } }
    ]
  });
  return matches.filter(page => page.id !== pageId);
}

async function appendChildren(pageId, blocks) {
  for (let offset = 0; offset < blocks.length; offset += 100) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(offset, offset + 100)
    });
  }
}

function readyProperties(source, article) {
  const sourceUrl = source.properties?.["Source URL"]?.url || "";
  const sourceLabel = article.author
    ? `${article.author} · ${new URL(article.canonicalUrl).hostname}`
    : new URL(article.canonicalUrl).hostname;
  const publishedAt = validDateStart(article.publishedAt);
  const properties = {
    Title: { title: notionText(article.title) },
    status: { status: { name: "Draft" } },
    Visibility: { select: { name: "Test" } },
    Language: { select: { name: "en" } },
    "Translate To": { multi_select: [{ name: "zh-TW" }, { name: "zh-CN" }] },
    "Translation Status": { select: { name: "Source" } },
    "Translation Group": { rich_text: notionText(`external:${source.id.replaceAll("-", "")}`) },
    Source: { rich_text: notionText(sourceLabel) },
    "Source URL": { url: sourceUrl },
    "Canonical URL": { url: article.canonicalUrl },
    "Source Hash": { rich_text: notionText(article.hash) },
    "Retrieved At": { date: { start: new Date().toISOString() } },
    "Ingestion Status": { select: { name: INGESTION_STATUS.READY } },
    "Ingestion Note": { rich_text: [] },
    "Rights Status": { select: { name: "Unknown" } }
  };
  if (publishedAt) properties["Source Published At"] = { date: { start: publishedAt } };
  return properties;
}

async function markNeedsReview(pageId, reason) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Ingestion Status": { select: { name: INGESTION_STATUS.NEEDS_REVIEW } },
      "Ingestion Note": { rich_text: notionText(reason) }
    }
  });
}

async function markDuplicate(pageId, article, duplicates) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Canonical URL": { url: article.canonicalUrl },
      "Source Hash": { rich_text: notionText(article.hash) },
      "Retrieved At": { date: { start: new Date().toISOString() } },
      "Ingestion Status": { select: { name: INGESTION_STATUS.DUPLICATE } },
      "Ingestion Note": {
        rich_text: notionText(`Duplicate of existing page(s): ${duplicates.map(page => page.id).join(", ")}`)
      }
    }
  });
}

const candidates = await pendingCandidates();
const report = {
  status: "complete",
  candidateCount: candidates.length,
  ready: [],
  duplicate: [],
  needsReview: []
};

for (const stub of candidates) {
  const source = await notion.pages.retrieve({ page_id: stub.id });
  const originalTitle = titleValue(source.properties ?? {});
  const sourceUrl = source.properties?.["Source URL"]?.url || "";
  try {
    if (originalTitle) {
      throw new Error("candidate page acquired a title after selection; ingestion only fills an empty inbox page");
    }
    if (await pageHasMaterialChildren(source.id)) {
      throw new Error("candidate page already contains body content; ingestion only fills an empty inbox page");
    }
    const fetched = await fetchArticleHtml(sourceUrl);
    const article = extractArticleDocument(fetched.html, fetched.url);
    const duplicates = await findDuplicates(source.id, article.canonicalUrl, article.hash);
    if (duplicates.length) {
      await markDuplicate(source.id, article, duplicates);
      report.duplicate.push({
        pageId: source.id,
        sourceUrl,
        canonicalUrl: article.canonicalUrl,
        existingPageIds: duplicates.map(page => page.id)
      });
      continue;
    }

    const children = notionBlocksFromArticle(article.blocks);
    await appendChildren(source.id, children);
    await notion.pages.update({ page_id: source.id, properties: readyProperties(source, article) });
    report.ready.push({
      pageId: source.id,
      sourceUrl,
      canonicalUrl: article.canonicalUrl,
      title: article.title,
      sourceHash: article.hash,
      blockCount: children.length,
      textLength: article.textLength
    });
  } catch (error) {
    const reason = safeText(error?.message || String(error));
    try {
      await markNeedsReview(source.id, reason);
    } catch (markError) {
      report.status = "partial";
      report.needsReview.push({
        pageId: source.id,
        sourceUrl,
        title: originalTitle,
        reason,
        markError: safeText(markError?.message || String(markError))
      });
      continue;
    }
    report.needsReview.push({ pageId: source.id, sourceUrl, title: originalTitle, reason });
  }
}

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `External source ingestion: ${report.status.toUpperCase()} ` +
  `(candidates=${report.candidateCount}, ready=${report.ready.length}, duplicate=${report.duplicate.length}, ` +
  `needsReview=${report.needsReview.length}, report=${reportPath})`
);

if (report.status !== "complete") process.exitCode = 1;
