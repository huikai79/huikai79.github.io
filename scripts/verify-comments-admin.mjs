#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const OUTPUT_DIR = path.resolve(process.env.COMMENTS_QA_OUTPUT || process.env.WEEKLY_QA_OUTPUT || "weekly-reader-a11y-qa");
const TOKEN = "qa-comments-admin-token-not-a-production-secret";

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    const calls = [];

    await page.route("**/api/comments/v1/admin/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      calls.push({ method: request.method(), path: url.pathname, auth: request.headers().authorization || "", body: request.postData() || "" });
      if (request.headers().authorization !== `Bearer ${TOKEN}`) {
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unauthorized" }) });
      }
      if (request.method() === "GET" && url.pathname.endsWith("/admin/pending")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, comments: [
          { id: "11111111-1111-4111-8111-111111111111", article_key: "notion:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", parent_id: null, display_name: "讀者甲", body: "<img src=x onerror=alert(1)> 純文字審核內容", created_at: "2026-09-10T00:00:00.000Z" },
          { id: "22222222-2222-4222-8222-222222222222", article_key: "notion:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", parent_id: "11111111-1111-4111-8111-111111111111", display_name: "讀者乙", body: "回覆內容", created_at: "2026-09-10T00:01:00.000Z" }
        ] }) });
      }
      if (request.method() === "POST" && /\/admin\/comments\/[0-9a-f-]+\/(approve|hide)$/i.test(url.pathname)) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      if (request.method() === "POST" && url.pathname.endsWith("/admin/replies")) {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, id: "33333333-3333-4333-8333-333333333333", status: "approved" }) });
      }
      return route.fulfill({ status: 404, body: "not found" });
    });

    const response = await page.goto(`${BASE_URL}/comments-admin/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response?.ok()) throw new Error(`comments admin ${name}: navigation failed ${response?.status()}`);
    const root = page.locator(".huikai-comments-admin");
    await root.waitFor({ state: "visible", timeout: 5000 });

    const head = await page.evaluate(() => ({
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || "",
      injected: Boolean(document.querySelector(".huikai-comments-admin__body img,.huikai-comments-admin__body script")),
      storage: Object.keys(localStorage).filter(key => /comment|admin|token/i.test(key)),
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    }));
    if (head.robots !== "noindex,nofollow,noarchive" || head.overflow > 1) throw new Error(`comments admin ${name}: head/layout contract failed ${JSON.stringify(head)}`);

    await page.locator("[data-comments-admin-token]").fill(TOKEN);
    await page.locator("[data-comments-admin-login] button[type=submit]").click();
    await page.locator(".huikai-comments-admin__item").first().waitFor({ state: "visible", timeout: 5000 });

    const authenticated = await page.evaluate(() => {
      const visibleButtonRects = [...document.querySelectorAll(".huikai-comments-admin button")]
        .map(el => el.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0);
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
    });
    if (authenticated.tokenValue || authenticated.injected || !authenticated.text.includes("<img") || authenticated.visibleButtonCount === 0 || authenticated.minButton < 44 || authenticated.overflow > 1) throw new Error(`comments admin ${name}: authenticated contract failed ${JSON.stringify(authenticated)}`);
    if (authenticated.localKeys.some(key => /admin.*token|token.*admin/i.test(key)) || authenticated.sessionKeys.some(key => /admin.*token|token.*admin/i.test(key))) throw new Error(`comments admin ${name}: admin token persisted in browser storage`);

    const first = page.locator(".huikai-comments-admin__item").first();
    await first.locator("textarea").fill("作者 QA 回覆");
    await first.getByRole("button", { name: "通過並回覆" }).click();
    await page.waitForTimeout(100);
    const approveCall = calls.find(call => call.method === "POST" && call.path.endsWith("/approve"));
    const replyCall = calls.find(call => call.method === "POST" && call.path.endsWith("/admin/replies"));
    if (!approveCall || !replyCall || approveCall.auth !== `Bearer ${TOKEN}` || replyCall.auth !== `Bearer ${TOKEN}`) throw new Error(`comments admin ${name}: moderation authorization contract failed`);
    const replyBody = JSON.parse(replyCall.body || "{}");
    if (replyBody.articleKey !== "notion:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" || replyBody.parentId !== "11111111-1111-4111-8111-111111111111" || replyBody.body !== "作者 QA 回覆") throw new Error(`comments admin ${name}: author reply payload drifted ${JSON.stringify(replyBody)}`);

    const screenshot = path.join(OUTPUT_DIR, `comments-admin-preview-${name}.png`);
    await root.screenshot({ path: screenshot });
    results.push({ name, head, authenticated, screenshot });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ status: "pass", surface: "comments-admin", results }, null, 2));
