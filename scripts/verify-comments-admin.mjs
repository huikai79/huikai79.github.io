#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const OUTPUT_DIR = path.resolve(process.env.COMMENTS_QA_OUTPUT || process.env.WEEKLY_QA_OUTPUT || "weekly-reader-a11y-qa");
const TOKEN = "qa-comments-admin-token-not-a-production-secret";
const ARTICLE = "notion:3d07a59e-0439-8048-ae89-da587d3ba5d0";
const UNKNOWN_ARTICLE = "notion:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const REPLY_ID = "22222222-2222-4222-8222-222222222222";

function adminComment(overrides = {}) {
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
  adminComment({ status: "pending" }),
  adminComment({ id: "44444444-4444-4444-8444-444444444444", article_key: UNKNOWN_ARTICLE, page_path: null, display_name: "讀者乙", body: "另一篇文章的待審核內容", created_at: "2026-09-10T00:01:00.000Z", status: "pending", effective_visible: 0 }),
];
const publishedConversation = [
  adminComment(),
  adminComment({ id: REPLY_ID, parent_id: ROOT_ID, reply_to_id: ROOT_ID, display_name: "HUIKAI", body: "作者補充", created_at: "2026-09-10T00:02:00.000Z", is_author: 1, root_display_name: "讀者甲", root_status: "approved", reply_to_display_name: "讀者甲", reply_to_status: "approved" }),
  adminComment({ id: "33333333-3333-4333-8333-333333333333", parent_id: ROOT_ID, reply_to_id: REPLY_ID, display_name: "", body: "", created_at: "2026-09-10T00:03:00.000Z", status: "withdrawn", root_display_name: "讀者甲", root_status: "approved", reply_to_display_name: "HUIKAI", reply_to_status: "approved", reply_to_is_author: 1 }),
];
const articleRows = [
  { article_key: ARTICLE, comment_count: 3, thread_count: 1, latest_at: "2026-09-10T00:03:00.000Z", page_path: "/posts/first-hackathon/" },
  { article_key: UNKNOWN_ARTICLE, comment_count: 1, thread_count: 1, latest_at: "2026-09-09T00:00:00.000Z", page_path: null },
];

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    const calls = [];
    const phases = [];

    const savePhase = async (phase, data) => {
      const record = { phase, ...data };
      phases.push(record);
      await fs.writeFile(path.join(OUTPUT_DIR, `comments-admin-v3-${name}-diagnostic.json`), JSON.stringify({ name, phases, calls }, null, 2), "utf8");
      await page.locator(".huikai-comments-admin").screenshot({ path: path.join(OUTPUT_DIR, `comments-admin-v3-${name}-${phase}.png`) }).catch(() => {});
      return record;
    };

    await page.route("**/api/comments/v1/admin/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      calls.push({ method: request.method(), path: url.pathname, search: url.search, auth: request.headers().authorization || "", body: request.postData() || "" });
      if (request.headers().authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unauthorized" }) });

      if (request.method() === "GET" && url.pathname.endsWith("/admin/articles")) {
        const limit = Number(url.searchParams.get("limit") || 20);
        const offset = Number(url.searchParams.get("offset") || 0);
        const rows = articleRows.slice(offset, offset + limit);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "approved", articles: rows, total: articleRows.length, limit, offset, hasMore: offset + rows.length < articleRows.length }) });
      }
      if (request.method() === "GET" && url.pathname.endsWith("/admin/comments")) {
        const status = url.searchParams.get("status") || "";
        const articleKey = url.searchParams.get("articleKey") || "";
        const limit = Number(url.searchParams.get("limit") || 25);
        const offset = Number(url.searchParams.get("offset") || 0);
        let rows = [];
        if (status === "pending") rows = pendingRows;
        else if (status === "approved" && articleKey === ARTICLE) rows = publishedConversation;
        else if (status === "approved") rows = publishedConversation.filter(item => item.status === "approved");
        const pageRows = rows.slice(offset, offset + limit);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status, articleKey: articleKey || null, comments: pageRows, total: rows.length, limit, offset, hasMore: offset + pageRows.length < rows.length }) });
      }
      if (request.method() === "GET" && url.pathname.endsWith("/admin/pending")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, comments: pendingRows }) });
      if (request.method() === "POST" && /\/admin\/comments\/[0-9a-f-]+\/(approve|hide|restore|delete)$/i.test(url.pathname)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: url.pathname.endsWith("/delete") ? "hard" : undefined }) });
      if (request.method() === "POST" && url.pathname.endsWith("/admin/replies")) return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, id: "55555555-5555-4555-8555-555555555555", status: "approved" }) });
      return route.fulfill({ status: 404, body: "not found" });
    });

    try {
      const response = await page.goto(`${BASE_URL}/comments-admin/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (!response?.ok()) throw new Error(`comments admin ${name}: navigation failed ${response?.status()}`);
      const root = page.locator(".huikai-comments-admin");
      await root.waitFor({ state: "visible", timeout: 5000 });

      const head = await savePhase("01-head", await page.evaluate(() => ({
        robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || "",
        manifestRows: (() => { try { return JSON.parse(document.querySelector("[data-comments-admin-article-manifest]")?.textContent || "[]").length; } catch { return -1; } })(),
        manifestSample: (() => { try { return JSON.parse(document.querySelector("[data-comments-admin-article-manifest]")?.textContent || "[]").slice(0, 3); } catch { return []; } })(),
        storage: Object.keys(localStorage).filter(key => /comment|admin|token/i.test(key)),
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      })));
      if (head.robots !== "noindex,nofollow,noarchive" || head.manifestRows < 1 || head.overflow > 1) throw new Error(`comments admin ${name}: head/manifest/layout contract failed ${JSON.stringify(head)}`);

      await page.locator("[data-comments-admin-token]").fill(TOKEN);
      await page.locator("[data-comments-admin-login] button[type=submit]").click();
      await page.locator(".huikai-comments-admin__item").first().waitFor({ state: "visible", timeout: 5000 });

      const authenticated = await savePhase("02-pending", await page.evaluate(() => {
        const visibleButtonRects = [...document.querySelectorAll(".huikai-comments-admin button")].map(el => el.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
        return {
          tokenValue: document.querySelector("[data-comments-admin-token]")?.value || "",
          localKeys: Object.keys(localStorage),
          sessionKeys: Object.keys(sessionStorage),
          injected: Boolean(document.querySelector(".huikai-comments-admin__body img,.huikai-comments-admin__body script")),
          text: document.querySelector(".huikai-comments-admin__body")?.textContent || "",
          visibleButtonCount: visibleButtonRects.length,
          minButton: visibleButtonRects.length ? Math.min(...visibleButtonRects.map(rect => rect.height)) : 0,
          overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        };
      }));
      if (authenticated.tokenValue || authenticated.injected || !authenticated.text.includes("<img") || authenticated.visibleButtonCount === 0 || authenticated.minButton < 44 || authenticated.overflow > 1) throw new Error(`comments admin ${name}: authenticated contract failed ${JSON.stringify(authenticated)}`);
      if (authenticated.localKeys.some(key => /admin.*token|token.*admin/i.test(key)) || authenticated.sessionKeys.some(key => /admin.*token|token.*admin/i.test(key))) throw new Error(`comments admin ${name}: admin token persisted in browser storage`);

      const first = page.locator(".huikai-comments-admin__item").first();
      await first.locator("textarea").fill("作者 QA 回覆");
      await first.getByRole("button", { name: "通過並回覆" }).click();
      await page.waitForTimeout(100);
      const approveCall = calls.find(call => call.method === "POST" && call.path.endsWith("/approve"));
      const replyCall = calls.find(call => call.method === "POST" && call.path.endsWith("/admin/replies"));
      await savePhase("03-after-reply", { approveCall: approveCall || null, replyCall: replyCall || null });
      if (!approveCall || !replyCall || approveCall.auth !== `Bearer ${TOKEN}` || replyCall.auth !== `Bearer ${TOKEN}`) throw new Error(`comments admin ${name}: moderation authorization contract failed`);
      const replyBody = JSON.parse(replyCall.body || "{}");
      if (replyBody.articleKey !== ARTICLE || replyBody.replyToId !== ROOT_ID || replyBody.body !== "作者 QA 回覆" || "parentId" in replyBody) throw new Error(`comments admin ${name}: V3 direct author reply payload drifted ${JSON.stringify(replyBody)}`);

      await page.getByRole("button", { name: "已公開" }).click();
      await page.locator(".huikai-comments-admin__article-card").first().waitFor({ state: "visible", timeout: 5000 });
      const articleList = await savePhase("04-articles", await page.evaluate(() => ({
        cards: document.querySelectorAll(".huikai-comments-admin__article-card").length,
        firstTitle: document.querySelector(".huikai-comments-admin__article-title")?.textContent?.trim() || "",
        allText: document.querySelector("[data-comments-admin-list]")?.textContent || "",
        searchVisible: !document.querySelector("[data-comments-admin-published-tools]")?.hidden,
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      })));
      if (articleList.cards !== 2 || !articleList.firstTitle.includes("Nutrient Hackathon") || !articleList.allText.includes("文章目前不在公開索引") || !articleList.searchVisible || articleList.overflow > 1) throw new Error(`comments admin ${name}: article-first list contract failed ${JSON.stringify(articleList)}`);

      const searchInput = page.locator("[data-comments-admin-search]");
      await searchInput.fill("Nutrient Hackathon");
      await page.locator("[data-comments-admin-search-form]").getByRole("button", { name: "搜尋" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".huikai-comments-admin__article-card").length === 1, { timeout: 5000 });
      const searchState = await savePhase("05-search", await page.evaluate(() => ({
        cards: document.querySelectorAll(".huikai-comments-admin__article-card").length,
        heading: document.querySelector("[data-comments-admin-heading]")?.textContent || "",
        title: document.querySelector(".huikai-comments-admin__article-title")?.textContent || "",
      })));
      if (searchState.cards !== 1 || !searchState.heading.includes("搜尋") || !searchState.title.includes("Nutrient Hackathon")) throw new Error(`comments admin ${name}: article search contract failed ${JSON.stringify(searchState)}`);

      await page.locator("[data-comments-admin-search-clear]").click();
      await page.waitForFunction(() => document.querySelectorAll(".huikai-comments-admin__article-card").length === 2, { timeout: 5000 });
      await savePhase("06-cleared", { cards: 2 });
      await page.locator(".huikai-comments-admin__article-card").first().getByRole("button", { name: "管理討論" }).click();
      await page.locator(".huikai-comments-admin__thread").first().waitFor({ state: "visible", timeout: 5000 });

      const detail = await savePhase("07-detail", await page.evaluate(() => ({
        threads: document.querySelectorAll(".huikai-comments-admin__thread").length,
        replies: document.querySelectorAll(".huikai-comments-admin__conversation-comment--reply").length,
        nestedReplies: document.querySelectorAll(".huikai-comments-admin__conversation-comment--reply .huikai-comments-admin__conversation-comment--reply").length,
        tombstone: [...document.querySelectorAll(".huikai-comments-admin__body--tombstone")].some(el => el.textContent.includes("撤回")),
        replyContext: [...document.querySelectorAll(".huikai-comments-admin__reply-context")].some(el => el.textContent.includes("回覆")),
        detailTitle: document.querySelector("[data-comments-admin-detail-title]")?.textContent || "",
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      })));
      if (detail.threads !== 1 || detail.replies !== 2 || detail.nestedReplies !== 0 || !detail.tombstone || !detail.replyContext || !detail.detailTitle.includes("Nutrient Hackathon") || detail.overflow > 1) throw new Error(`comments admin ${name}: article conversation contract failed ${JSON.stringify(detail)}`);

      const articleCall = calls.find(call => call.method === "GET" && call.path.endsWith("/admin/articles"));
      const conversationCall = calls.find(call => call.method === "GET" && call.path.endsWith("/admin/comments") && new URLSearchParams(call.search).get("articleKey") === ARTICLE);
      if (!articleCall || !conversationCall) throw new Error(`comments admin ${name}: article-first API calls missing`);

      const screenshot = path.join(OUTPUT_DIR, `comments-admin-v3-preview-${name}.png`);
      await root.screenshot({ path: screenshot });
      results.push({ name, head, authenticated, articleList, searchState, detail, screenshot });
    } catch (error) {
      await fs.writeFile(path.join(OUTPUT_DIR, `comments-admin-v3-${name}-error.json`), JSON.stringify({ name, message: error?.message || String(error), stack: error?.stack || "", phases, calls }, null, 2), "utf8");
      await page.locator(".huikai-comments-admin").screenshot({ path: path.join(OUTPUT_DIR, `comments-admin-v3-${name}-error.png`) }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ status: "pass", surface: "comments-admin-v3", results }, null, 2));
