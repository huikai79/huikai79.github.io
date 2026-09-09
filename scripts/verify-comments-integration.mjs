#!/usr/bin/env node
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const ARTICLE_PATH = process.env.COMMENTS_QA_ARTICLE || "/posts/first-hackathon/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();

try {
  await page.route("https://giscus.app/client.js", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: `(() => {
        const script = document.currentScript;
        const container = script?.parentElement;
        if (!container) return;
        const frame = document.createElement('iframe');
        frame.className = 'giscus-frame';
        frame.title = 'Giscus comments test frame';
        frame.src = 'about:blank';
        container.appendChild(frame);
      })();`,
    });
  });

  const response = await page.goto(`${BASE_URL}${ARTICLE_PATH}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (!response?.ok()) throw new Error(`comments integration navigation failed: HTTP ${response?.status() ?? "NO_RESPONSE"}`);

  await page.locator("iframe.giscus-frame").waitFor({ state: "attached", timeout: 5_000 });

  const result = await page.evaluate(() => {
    const comments = document.querySelector(".giscus-comments");
    const commentsFooter = comments?.closest(".article-footer");
    const readingColumn = comments?.closest(".article-reading-content");
    const siblingFooters = [...document.querySelectorAll(".article-reading-content > .article-footer")]
      .filter(element => element !== commentsFooter);
    const referenceFooter = siblingFooters.at(-1);
    const scripts = [...document.querySelectorAll('script[src^="https://giscus.app/client.js"]')];
    const frames = [...document.querySelectorAll("iframe.giscus-frame")];

    const rect = element => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    };

    return {
      commentKey: comments?.getAttribute("data-comment-key") || "",
      scriptCount: scripts.length,
      iframeCount: frames.length,
      mapping: scripts[0]?.getAttribute("data-mapping") || "",
      term: scripts[0]?.getAttribute("data-term") || "",
      strict: scripts[0]?.getAttribute("data-strict") || "",
      commentsFooter: rect(commentsFooter),
      referenceFooter: rect(referenceFooter),
      readingColumn: rect(readingColumn),
    };
  });

  if (!result.commentKey) throw new Error("comments integration: data-comment-key is missing");
  if (result.scriptCount !== 1) throw new Error(`comments integration: expected one Giscus client script, got ${result.scriptCount}`);
  if (result.iframeCount !== 1) throw new Error(`comments integration: expected one deterministic Giscus iframe, got ${result.iframeCount}`);
  if (result.mapping !== "specific") throw new Error(`comments integration: expected data-mapping=specific, got ${result.mapping || "EMPTY"}`);
  if (result.term !== result.commentKey) throw new Error(`comments integration: data-term does not match commentKey (${result.term} vs ${result.commentKey})`);
  if (result.strict !== "1") throw new Error(`comments integration: expected data-strict=1, got ${result.strict || "EMPTY"}`);
  if (!result.commentsFooter || !result.referenceFooter || !result.readingColumn) {
    throw new Error("comments integration: unable to measure reading-column geometry");
  }

  const leftDelta = Math.abs(result.commentsFooter.left - result.referenceFooter.left);
  const rightDelta = Math.abs(result.commentsFooter.right - result.referenceFooter.right);
  if (leftDelta > 2 || rightDelta > 2) {
    throw new Error(`comments integration: footer alignment drift left=${leftDelta.toFixed(2)}px right=${rightDelta.toFixed(2)}px`);
  }
  if (
    result.commentsFooter.left < result.readingColumn.left - 2 ||
    result.commentsFooter.right > result.readingColumn.right + 2
  ) {
    throw new Error("comments integration: comments footer escapes article reading column");
  }

  console.log(JSON.stringify({ status: "pass", article: ARTICLE_PATH, ...result }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
