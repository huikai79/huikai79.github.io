#!/usr/bin/env node
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const ROUTE = "/posts/first-hackathon/";
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function openPage(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  const response = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "networkidle", timeout: 45_000 });
  if (!response?.ok()) fail(`TOC behavior ${width}x${height}: navigation failed (${response?.status() ?? "no response"})`);
  return { context, page };
}

async function compactMode(browser, width, height, label) {
  const { context, page } = await openPage(browser, width, height);
  try {
    const state = await page.evaluate(() => {
      const toc = document.querySelector(".article-toc");
      const desktop = document.querySelector(".article-toc #TOCView");
      const compact = document.querySelector(".article-toc .toc-inside");
      const summary = compact?.querySelector("summary");
      const content = document.querySelector(".article-reading-content");
      if (!toc || !content) return null;
      const visible = element => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const tocRect = toc.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        tocTop: tocRect.top,
        tocBottom: tocRect.bottom,
        contentTop: contentRect.top,
        desktopVisible: visible(desktop),
        compactVisible: visible(compact),
        summaryVisible: visible(summary),
        position: getComputedStyle(toc).position,
      };
    });
    if (!state) return fail(`${label}: TOC/content geometry unavailable`);
    if (state.desktopVisible) fail(`${label}: expanded desktop TOC must not be visible before 1280px`);
    if (!state.compactVisible || !state.summaryVisible) fail(`${label}: compact TOC disclosure is not visible`);
    if (state.tocBottom > state.contentTop + 2) fail(`${label}: compact TOC must remain above article content`);
    if (state.position === "sticky") fail(`${label}: compact TOC should participate in normal document flow, not sticky sidebar mode`);
  } finally {
    await context.close();
  }
}

async function desktopStickyMode(browser) {
  const { context, page } = await openPage(browser, 1440, 900);
  try {
    const before = await page.evaluate(() => {
      const toc = document.querySelector(".article-toc");
      const desktop = document.querySelector(".article-toc #TOCView");
      const compact = document.querySelector(".article-toc .toc-inside");
      const link = document.querySelector(".article-toc #TableOfContents a");
      if (!toc || !desktop || !link) return null;
      const visible = element => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const rect = toc.getBoundingClientRect();
      const style = getComputedStyle(toc);
      const desktopStyle = getComputedStyle(desktop);
      const linkStyle = getComputedStyle(link);
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        position: style.position,
        stickyOffset: parseFloat(style.top || "0"),
        desktopVisible: visible(desktop),
        compactVisible: visible(compact),
        desktopMaxHeight: desktopStyle.maxHeight,
        fontSize: parseFloat(linkStyle.fontSize || "0"),
        fontWeight: linkStyle.fontWeight,
        viewportHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      };
    });
    if (!before) return fail("desktop: TOC geometry unavailable");
    if (before.position !== "sticky") fail(`desktop: TOC sidebar computed position is ${before.position}, expected sticky`);
    if (!before.desktopVisible) fail("desktop: expanded TOC is not visible at 1440px");
    if (before.compactVisible) fail("desktop: compact TOC must be hidden when sidebar mode is active");
    if (!(before.fontSize > 0 && before.fontSize <= 15)) fail(`desktop: TOC link font size is ${before.fontSize}px, expected <=15px`);
    if (Number.parseInt(before.fontWeight, 10) >= 600) fail(`desktop: TOC link weight is ${before.fontWeight}, expected normal/subordinate navigation weight`);
    if (before.height > before.viewportHeight - before.stickyOffset + 2) fail(`desktop: TOC sidebar height ${before.height.toFixed(1)}px exceeds sticky viewport budget`);

    const maxScroll = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    const target = Math.min(900, Math.max(0, maxScroll - 20));
    if (target < 200) return fail(`desktop: article is not tall enough to exercise sticky behavior (maxScroll=${maxScroll})`);
    await page.evaluate(y => window.scrollTo(0, y), target);
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => {
      const toc = document.querySelector(".article-toc");
      if (!toc) return null;
      const rect = toc.getBoundingClientRect();
      const style = getComputedStyle(toc);
      return {
        scrollY: window.scrollY,
        top: rect.top,
        bottom: rect.bottom,
        position: style.position,
        stickyOffset: parseFloat(style.top || "0"),
        viewportHeight: window.innerHeight,
      };
    });
    if (!after) return fail("desktop: post-scroll TOC geometry unavailable");
    if (after.scrollY < 100) fail(`desktop: browser did not scroll enough to exercise sticky state (${after.scrollY}px)`);
    if (after.position !== "sticky") fail(`desktop: TOC lost sticky position after scroll (${after.position})`);
    if (Math.abs(after.top - after.stickyOffset) > 3) fail(`desktop: TOC did not stick to configured offset; top=${after.top.toFixed(1)}px offset=${after.stickyOffset.toFixed(1)}px`);
    if (after.top < -1 || after.bottom > after.viewportHeight + 2) fail(`desktop: sticky TOC escaped viewport after scroll (top=${after.top.toFixed(1)}, bottom=${after.bottom.toFixed(1)}, viewport=${after.viewportHeight})`);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await compactMode(browser, 390, 844, "mobile");
    await compactMode(browser, 1279, 900, "pre-breakpoint");
    await desktopStickyMode(browser);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`TOC behavior verification: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }
  console.log("TOC behavior verification: PASS (compact <1280px + native typography + actual desktop sticky scroll)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
