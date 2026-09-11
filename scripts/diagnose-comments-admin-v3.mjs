#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const OUTPUT_DIR = path.resolve(process.env.COMMENTS_QA_OUTPUT || "weekly-reader-a11y-qa");
const TOKEN = "qa-comments-admin-token-not-a-production-secret";
const ARTICLE = "notion:3d07a59e-0439-8048-ae89-da587d3ba5d0";
const UNKNOWN_ARTICLE = "notion:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const REPLY_ID = "22222222-2222-4222-8222-222222222222";

function comment(overrides = {}) {
  return {
    id: ROOT_ID,
    article_key: ARTICLE,
    parent_id: null,
    reply_to_id: null,
    page_path: "/posts/first-hackathon/",
    display_name: "讀者甲",
    body: "<img src=x onerror=alert(1)> 純文字審核內容",
    created_at: "2026-09-10T00:00:00.000Z",
    status: "approved",
    is_author: 0,
    removed_by_admin: 0,
    root_display_name: null,
    root_status: null,
    root_removed_by_admin: null,
    reply_to_display_name: null,
    reply_to_status: null,
    reply_to_is_author: null,
    reply_to_removed_by_admin: null,
    effective_visible: 1,
    ...overrides,
  };
}

const pendingRows = [
  comment({ status: "pending" }),
  comment({ id: "44444444-4444-4444-8444-444444444444", article_key: UNKNOWN_ARTICLE, page_path: null, display_name: "讀者乙", body: "另一篇文章的待審核內容", created_at: "2026-09-10T00:01:00.000Z", status: "pending", effective_visible: 0 }),
];
const conversation = [
  comment(),
  comment({ id: REPLY_ID, parent_id: ROOT_ID, reply_to_id: ROOT_ID, display_name: "HUIKAI", body: "作者補充", created_at: "2026-09-10T00:02:00.000Z", is_author: 1, root_display_name: "讀者甲", root_status: "approved", reply_to_display_name: "讀者甲", reply_to_status: "approved" }),
  comment({ id: "33333333-3333-4333-8333-333333333333", parent_id: ROOT_ID, reply_to_id: REPLY_ID, display_name: "", body: "", created_at: "2026-09-10T00:03:00.000Z", status: "withdrawn", root_display_name: "讀者甲", root_status: "approved", reply_to_display_name: "HUIKAI", reply_to_status: "approved", reply_to_is_author: 1 }),
];
const articles = [
  { article_key: ARTICLE, comment_count: 3, thread_count: 1, latest_at: "2026-09-10T00:03:00.000Z", page_path: "/posts/first-hackathon/" },
  { article_key: UNKNOWN_ARTICLE, comment_count: 1, thread_count: 1, latest_at: "2026-09-09T00:00:00.000Z", page_path: null },
];

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const report = { baseUrl: BASE_URL, phases: [], calls: [], error: null };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
const page = await context.newPage();

async function snapshot(phase) {
  const data = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || "",
    manifestRaw: document.querySelector("[data-comments-admin-article-manifest]")?.textContent || "",
    manifestRows: (() => { try { return JSON.parse(document.querySelector("[data-comments-admin-article-manifest]")?.textContent || "[]").length; } catch { return -1; } })(),
    panelHidden: document.querySelector("[data-comments-admin-panel]")?.hidden,
    status: document.querySelector("[data-comments-admin-status]")?.textContent || "",
    heading: document.querySelector("[data-comments-admin-heading]")?.textContent || "",
    itemCount: document.querySelectorAll(".huikai-comments-admin__item").length,
    cardCount: document.querySelectorAll(".huikai-comments-admin__article-card").length,
    threadCount: document.querySelectorAll(".huikai-comments-admin__thread").length,
    replyCount: document.querySelectorAll(".huikai-comments-admin__conversation-comment--reply").length,
    searchHidden: document.querySelector("[data-comments-admin-published-tools]")?.hidden,
    detailHidden: document.querySelector("[data-comments-admin-detail-header]")?.hidden,
    text: document.querySelector(".huikai-comments-admin")?.textContent || "",
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  }));
  report.phases.push({ phase, ...data });
  await fs.writeFile(path.join(OUTPUT_DIR, "comments-admin-v3-diagnostic.json"), JSON.stringify(report, null, 2), "utf8");
  await page.locator(".huikai-comments-admin").screenshot({ path: path.join(OUTPUT_DIR, `comments-admin-v3-diagnostic-${phase}.png`) }).catch(() => {});
}

await page.route("**/api/comments/v1/admin/**", async route => {
  const request = route.request();
  const url = new URL(request.url());
  report.calls.push({ method: request.method(), path: url.pathname, search: url.search, auth: request.headers().authorization || "", body: request.postData() || "" });
  if (request.headers().authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unauthorized" }) });
  if (request.method() === "GET" && url.pathname.endsWith("/admin/articles")) {
    const limit = Number(url.searchParams.get("limit") || 20); const offset = Number(url.searchParams.get("offset") || 0); const rows = articles.slice(offset, offset + limit);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "approved", articles: rows, total: articles.length, limit, offset, hasMore: offset + rows.length < articles.length }) });
  }
  if (request.method() === "GET" && url.pathname.endsWith("/admin/comments")) {
    const status = url.searchParams.get("status") || ""; const articleKey = url.searchParams.get("articleKey") || ""; const limit = Number(url.searchParams.get("limit") || 25); const offset = Number(url.searchParams.get("offset") || 0);
    let rows = [];
    if (status === "pending") rows = pendingRows;
    else if (status === "approved" && articleKey === ARTICLE) rows = conversation;
    else if (status === "approved") rows = conversation.filter(item => item.status === "approved");
    const pageRows = rows.slice(offset, offset + limit);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status, articleKey: articleKey || null, comments: pageRows, total: rows.length, limit, offset, hasMore: offset + pageRows.length < rows.length }) });
  }
  if (request.method() === "GET" && url.pathname.endsWith("/admin/pending")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, comments: pendingRows }) });
  if (request.method() === "POST" && /\/admin\/comments\/[0-9a-f-]+\/(approve|hide|restore|delete)$/i.test(url.pathname)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: url.pathname.endsWith("/delete") ? "hard" : undefined }) });
  if (request.method() === "POST" && url.pathname.endsWith("/admin/replies")) return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, id: "55555555-5555-4555-8555-555555555555", status: "approved" }) });
  return route.fulfill({ status: 404, body: "not found" });
});

try {
  await page.goto(`${BASE_URL}/comments-admin/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator(".huikai-comments-admin").waitFor({ state: "visible", timeout: 5000 });
  await snapshot("01-head");
  await page.locator("[data-comments-admin-token]").fill(TOKEN);
  await page.locator("[data-comments-admin-login] button[type=submit]").click();
  await page.locator(".huikai-comments-admin__item").first().waitFor({ state: "visible", timeout: 5000 });
  await snapshot("02-pending");
  const first = page.locator(".huikai-comments-admin__item").first();
  await first.locator("textarea").fill("作者 QA 回覆");
  await first.getByRole("button", { name: "通過並回覆" }).click();
  await page.waitForTimeout(150);
  await snapshot("03-after-reply");
  await page.getByRole("button", { name: "已公開" }).click();
  await page.locator(".huikai-comments-admin__article-card").first().waitFor({ state: "visible", timeout: 5000 });
  await snapshot("04-articles");
  await page.locator("[data-comments-admin-search]").fill("Nutrient Hackathon");
  await page.locator("[data-comments-admin-search-form]").getByRole("button", { name: "搜尋" }).click();
  await page.waitForTimeout(150);
  await snapshot("05-search");
  await page.locator("[data-comments-admin-search-clear]").click();
  await page.waitForTimeout(150);
  await snapshot("06-cleared");
  await page.locator(".huikai-comments-admin__article-card").first().getByRole("button", { name: "管理討論" }).click();
  await page.locator(".huikai-comments-admin__thread").first().waitFor({ state: "visible", timeout: 5000 });
  await snapshot("07-detail");
} catch (error) {
  report.error = { message: error?.message || String(error), stack: error?.stack || "" };
  await fs.writeFile(path.join(OUTPUT_DIR, "comments-admin-v3-diagnostic.json"), JSON.stringify(report, null, 2), "utf8");
  await page.locator(".huikai-comments-admin").screenshot({ path: path.join(OUTPUT_DIR, "comments-admin-v3-diagnostic-error.png") }).catch(() => {});
} finally {
  await context.close();
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
