#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const OUTPUT_DIR = path.resolve(process.env.WEEKLY_QA_OUTPUT || process.env.LIVE_QA_OUTPUT || "post-preview-geometry-qa");
const failures = [];
const report = { baseUrl: BASE_URL, startedAt: new Date().toISOString(), samples: {} };

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

function near(a, b, tolerance = 4) {
  return Math.abs(a - b) <= tolerance;
}

async function open(page, route, label) {
  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
  if (!response?.ok()) fail(`${label}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
}

async function verifyPostListDesktop(browser, width, label) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await open(page, "/posts/", `posts/${label}`);
    const state = await page.evaluate(() => {
      const withMedia = document.querySelector(".huikai-post-list-item--with-media");
      const textOnly = document.querySelector(".huikai-post-list-item--text-only");
      const rect = element => {
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      const withContent = withMedia?.querySelector(".huikai-post-list-content");
      const media = withMedia?.querySelector(".huikai-post-list-media");
      const textContent = textOnly?.querySelector(".huikai-post-list-content");
      return {
        withItem: rect(withMedia),
        textItem: rect(textOnly),
        withContent: rect(withContent),
        textContent: rect(textContent),
        media: rect(media),
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    report.samples[`posts-${label}`] = state;
    if (!state.withItem || !state.textItem || !state.withContent || !state.textContent || !state.media) {
      fail(`posts/${label}: requires at least one post with media and one text-only post`);
      return;
    }
    if (!near(state.withContent.left, state.textContent.left, 2)) fail(`posts/${label}: text columns start at different x positions (${state.withContent.left.toFixed(1)} vs ${state.textContent.left.toFixed(1)})`);
    if (!near(state.withContent.right, state.textContent.right, 4)) fail(`posts/${label}: text columns end at different x positions (${state.withContent.right.toFixed(1)} vs ${state.textContent.right.toFixed(1)})`);
    if (!near(state.withContent.width, state.textContent.width, 4)) fail(`posts/${label}: text measures differ (${state.withContent.width.toFixed(1)}px vs ${state.textContent.width.toFixed(1)}px)`);
    if (!near(state.media.width, 300, 2)) fail(`posts/${label}: media width drifted (${state.media.width.toFixed(1)}px)`);
    if (state.withContent.right > state.media.left - 20) fail(`posts/${label}: text/media gap collapsed (${(state.media.left - state.withContent.right).toFixed(1)}px)`);
    if (state.withContent.left < state.withItem.left - 1 || state.media.right > state.withItem.right + 1 || state.textContent.right > state.textItem.right + 1) fail(`posts/${label}: preview geometry escapes its item bounds`);
    if (state.overflow > 1) fail(`posts/${label}: horizontal overflow ${state.overflow.toFixed(1)}px`);
  } finally {
    await context.close();
  }
}

async function verifyPostListMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await open(page, "/posts/", "posts/mobile");
    const state = await page.evaluate(() => {
      const withMedia = document.querySelector(".huikai-post-list-item--with-media");
      const textOnly = document.querySelector(".huikai-post-list-item--text-only");
      const rect = element => {
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      return {
        withItem: rect(withMedia),
        textItem: rect(textOnly),
        withContent: rect(withMedia?.querySelector(".huikai-post-list-content")),
        textContent: rect(textOnly?.querySelector(".huikai-post-list-content")),
        media: rect(withMedia?.querySelector(".huikai-post-list-media")),
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    report.samples["posts-mobile"] = state;
    if (!state.withItem || !state.textItem || !state.withContent || !state.textContent || !state.media) {
      fail("posts/mobile: requires at least one post with media and one text-only post");
      return;
    }
    if (!near(state.withContent.width, state.withItem.width, 4)) fail(`posts/mobile: media-post text does not reclaim full width (${state.withContent.width.toFixed(1)} vs ${state.withItem.width.toFixed(1)}px)`);
    if (!near(state.textContent.width, state.textItem.width, 4)) fail(`posts/mobile: text-only post does not use full width (${state.textContent.width.toFixed(1)} vs ${state.textItem.width.toFixed(1)}px)`);
    if (!near(state.media.width, state.withItem.width, 4)) fail(`posts/mobile: media is not full-width (${state.media.width.toFixed(1)} vs ${state.withItem.width.toFixed(1)}px)`);
    if (state.withContent.top < state.media.bottom - 1) fail("posts/mobile: media and text overlap instead of stacking");
    if (state.overflow > 1) fail(`posts/mobile: horizontal overflow ${state.overflow.toFixed(1)}px`);
  } finally {
    await context.close();
  }
}

async function verifyRelatedReading(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await open(page, "/posts/first-hackathon/", "related-reading");
    const state = await page.evaluate(() => {
      const list = document.querySelector(".related-reading-list");
      const heading = list?.previousElementSibling;
      const items = [...(list?.querySelectorAll(".related-reading-item") || [])];
      const summaries = [...(list?.querySelectorAll(".related-reading-summary") || [])];
      const headingStyle = heading ? getComputedStyle(heading) : null;
      return {
        itemCount: items.length,
        headingMarginBottom: headingStyle ? Number.parseFloat(headingStyle.marginBottom || "0") : null,
        itemPadding: items.map(item => {
          const style = getComputedStyle(item);
          return [Number.parseFloat(style.paddingTop || "0"), Number.parseFloat(style.paddingBottom || "0")];
        }),
        summaryClamp: summaries.map(summary => getComputedStyle(summary).webkitLineClamp || ""),
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    report.samples.related = state;
    if (state.itemCount < 1) return fail("related-reading: no related items rendered");
    if ((state.headingMarginBottom ?? 0) < 23) fail(`related-reading: heading gap is too tight (${state.headingMarginBottom}px)`);
    for (const [index, [top, bottom]] of state.itemPadding.entries()) {
      if (top < 23 || bottom < 23) fail(`related-reading: item ${index + 1} padding is too tight (${top}px/${bottom}px)`);
    }
    for (const [index, clamp] of state.summaryClamp.entries()) {
      if (clamp !== "2") fail(`related-reading: summary ${index + 1} is not clamped to two lines (${clamp || "unset"})`);
    }
    if (state.overflow > 1) fail(`related-reading: horizontal overflow ${state.overflow.toFixed(1)}px`);
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyPostListDesktop(browser, 1440, "desktop");
    await verifyPostListDesktop(browser, 853, "breakpoint");
    await verifyPostListMobile(browser);
    await verifyRelatedReading(browser);
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(path.join(OUTPUT_DIR, "post-preview-geometry.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) {
    console.error(`Post preview geometry verification: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }
  console.log("Post preview geometry verification: PASS (stable desktop text measure + optional media + mobile reclaim + related-reading rhythm)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
