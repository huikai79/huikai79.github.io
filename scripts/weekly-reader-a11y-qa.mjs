#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { chromium, firefox, webkit } from "playwright";

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core/axe.min.js");
const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const OUT_DIR = path.resolve(process.env.WEEKLY_QA_OUTPUT || "weekly-reader-a11y-qa");
const EXPECTED_SHA = (process.env.EXPECTED_SOURCE_SHA || "").trim();
const ROUTES = [
  ["home", "/"],
  ["posts", "/posts/"],
  ["projects", "/projects/"],
  ["about", "/about/"],
  ["long-article", "/posts/first-hackathon/"],
  ["zh-cn-article", "/zh-cn/posts/how-you-know/"],
];
const VIEWPORTS = [["desktop", 1440, 1000], ["mobile", 390, 844]];
const ARTICLE_VIEWPORTS = [["pre-breakpoint", 1279, 900], ["breakpoint", 1280, 900], ["desktop", 1440, 1000], ["wide-desktop", 1600, 1000]];
const BROWSERS = { chromium, firefox, webkit };
const AXE_ROUTES = [["home", "/"], ["long-article", "/posts/first-hackathon/"], ["zh-cn-article", "/zh-cn/posts/how-you-know/"]];
const VISUAL_ROUTES = [["home", "/"], ["posts", "/posts/"], ["projects", "/projects/"], ["long-article", "/posts/first-hackathon/"]];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const report = { baseUrl: BASE_URL, expectedSourceSha: EXPECTED_SHA || null, startedAt: new Date().toISOString(), browsers: {}, visualEvidence: [], layout: {}, failures: [] };

function fail(message) {
  report.failures.push(message);
  console.error(`::error::${message}`);
}

async function verifyLineage() {
  const response = await fetch(`${BASE_URL}/source-commit.txt`, { redirect: "follow" });
  if (!response.ok) return fail(`source lineage: HTTP ${response.status}`);
  const actual = (await response.text()).trim();
  report.actualSourceSha = actual;
  if (EXPECTED_SHA && actual !== EXPECTED_SHA) fail(`source lineage mismatch: expected=${EXPECTED_SHA}, actual=${actual}`);
}

async function ensureTheme(page, colorScheme, label) {
  const desiredDark = colorScheme === "dark";
  let actualDark = await page.locator("html").evaluate(el => el.classList.contains("dark"));
  if (actualDark !== desiredDark) {
    const switcher = page.locator("#appearance-switcher:visible, #appearance-switcher-mobile:visible").first();
    if (!(await switcher.count())) {
      fail(`${label}: visible appearance switcher missing while requesting ${colorScheme}`);
      return actualDark;
    }
    await switcher.click();
    await page.waitForTimeout(200);
    actualDark = await page.locator("html").evaluate(el => el.classList.contains("dark"));
  }
  if (actualDark !== desiredDark) fail(`${label}: requested ${colorScheme} but html.dark=${actualDark}`);
  return actualDark;
}

async function smoke(browserName, browser, routeName, routePath, viewportName, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const text = (document.querySelector("main")?.innerText || document.body.innerText || "").trim();
      const originalY = window.scrollY;
      const rawOverflowX = Math.max(0, root.scrollWidth - root.clientWidth);
      window.scrollTo(20, originalY);
      const scrollableX = Math.abs(window.scrollX);
      window.scrollTo(0, originalY);
      return {
        statusTextLength: text.length,
        h1Count: document.querySelectorAll("h1").length,
        rawOverflowX,
        scrollableX,
        overflowXStyle: getComputedStyle(root).overflowX,
        brokenImages: [...document.images].filter(img => img.complete && img.naturalWidth === 0).map(img => img.currentSrc || img.src || img.alt || "unknown"),
        lang: root.lang || "",
      };
    });
    const entry = { route: routePath, viewport: viewportName, status: response?.status() ?? null, metrics };
    report.browsers[browserName].smoke.push(entry);
    if (!response?.ok()) fail(`${browserName}/${routeName}/${viewportName}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
    if (metrics.statusTextLength < 20) fail(`${browserName}/${routeName}/${viewportName}: main content appears empty`);
    if (metrics.h1Count !== 1) fail(`${browserName}/${routeName}/${viewportName}: expected 1 H1, got ${metrics.h1Count}`);
    if (metrics.scrollableX > 1) fail(`${browserName}/${routeName}/${viewportName}: horizontally scrollable by ${metrics.scrollableX}px (raw overflow ${metrics.rawOverflowX}px)`);
    if (metrics.brokenImages.length) fail(`${browserName}/${routeName}/${viewportName}: broken images: ${metrics.brokenImages.join(", ")}`);
  } finally {
    await context.close();
  }
}

async function axeAudit(browserName, browser, routeName, routePath, colorScheme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
    await ensureTheme(page, colorScheme, `${browserName}/${routeName}/axe/${colorScheme}`);
    await page.addScriptTag({ path: AXE_PATH });
    const result = await page.evaluate(async tags => {
      const output = await globalThis.axe.run(document, { runOnly: { type: "tag", values: tags } });
      return {
        violations: output.violations.map(v => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })),
        })),
      };
    }, AXE_TAGS);
    report.browsers[browserName].axe.push({ route: routePath, colorScheme, ...result });
    for (const violation of result.violations) {
      fail(`${browserName}/${routeName}/${colorScheme}: axe ${violation.id} (${violation.impact || "unknown"}) on ${violation.nodes.length} node(s)`);
    }
  } finally {
    await context.close();
  }
}

async function keyboardAndTargets(browserName, browser, routeName, routePath) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const focusTrail = [];
    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press("Tab");
      const state = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        const focusVisible = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0) || style.boxShadow !== "none";
        return { tag: el.tagName, id: el.id || "", text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 80), visible, focusVisible };
      });
      if (state) focusTrail.push(state);
    }
    const visibleFocused = focusTrail.filter(item => item.visible);
    const indicatorCount = visibleFocused.filter(item => item.focusVisible).length;
    if (visibleFocused.length < 4) fail(`${browserName}/${routeName}: keyboard traversal exposed only ${visibleFocused.length} visible focus targets`);
    if (indicatorCount === 0) fail(`${browserName}/${routeName}: no visible keyboard focus indicator detected`);

    const targets = await page.evaluate(() => {
      const selector = "header a, header button, #site-footer a, #site-footer button, #scroll-to-top";
      return [...document.querySelectorAll(selector)].filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }).map(el => {
        const rect = el.getBoundingClientRect();
        return { label: (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().slice(0, 80), width: rect.width, height: rect.height };
      });
    });
    const undersized = targets.filter(target => target.width < 24 || target.height < 24);
    if (undersized.length) fail(`${browserName}/${routeName}: utility targets below 24px: ${undersized.map(t => `${t.label}=${t.width.toFixed(1)}x${t.height.toFixed(1)}`).join(", ")}`);

    let searchGeometry = null;
    if (routeName === "home") {
      searchGeometry = await page.evaluate(() => {
        const button = document.querySelector("#search-button");
        const hint = document.querySelector("#search-shortcut-hint");
        if (!button || !hint) return null;
        const buttonRect = button.getBoundingClientRect();
        const hintRect = hint.getBoundingClientRect();
        return {
          clientWidth: button.clientWidth,
          scrollWidth: button.scrollWidth,
          width: buttonRect.width,
          height: buttonRect.height,
          hintLeft: hintRect.left,
          hintRight: hintRect.right,
          buttonLeft: buttonRect.left,
          buttonRight: buttonRect.right,
          hintWhiteSpace: getComputedStyle(hint).whiteSpace,
          hintText: (hint.textContent || "").trim(),
        };
      });
      if (!searchGeometry) fail(`${browserName}/home: unable to measure search button geometry`);
      else {
        if (searchGeometry.scrollWidth > searchGeometry.clientWidth + 1) fail(`${browserName}/home: search button content overflows by ${(searchGeometry.scrollWidth - searchGeometry.clientWidth).toFixed(1)}px`);
        if (searchGeometry.hintLeft < searchGeometry.buttonLeft - 1 || searchGeometry.hintRight > searchGeometry.buttonRight + 1) fail(`${browserName}/home: search shortcut hint escapes button bounds`);
        if (searchGeometry.hintWhiteSpace !== "nowrap") fail(`${browserName}/home: search shortcut hint may wrap (${searchGeometry.hintWhiteSpace})`);
      }
    }

    report.browsers[browserName].keyboard.push({ route: routePath, focusTrail, targetCount: targets.length, undersized, searchGeometry });
  } finally {
    await context.close();
  }
}

async function verifyArticleLayout(browser) {
  const samples = [];
  for (const [label, width, height] of ARTICLE_VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/posts/first-hackathon/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
      await ensureTheme(page, "dark", `article-layout/${label}`);
      const geometry = await page.evaluate(() => {
        const layout = document.querySelector(".article-reading-layout");
        const content = document.querySelector(".article-reading-content");
        const article = document.querySelector(".article-main");
        const toc = document.querySelector(".article-toc");
        const footer = document.querySelector(".article-footer");
        const footerInsideReading = document.querySelector(".article-reading-layout .article-footer");
        const hero = document.querySelector(".post-hero");
        if (!layout || !content || !article || !footer) return null;
        const toPlainRect = element => {
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        return {
          viewportWidth: document.documentElement.clientWidth,
          layout: toPlainRect(layout),
          content: toPlainRect(content),
          article: toPlainRect(article),
          toc: toPlainRect(toc),
          footer: toPlainRect(footer),
          footerInsideReading: Boolean(footerInsideReading),
          hero: toPlainRect(hero),
        };
      });
      samples.push({ label, width, geometry });
      if (!geometry) {
        fail(`article-layout/${label}: unable to measure reading layout`);
        continue;
      }
      if (geometry.article.width < 600 && width >= 1280) fail(`article-layout/${label}: article column collapsed to ${geometry.article.width.toFixed(1)}px`);
      if (geometry.footerInsideReading) fail(`article-layout/${label}: post-reading footer remains inside TOC reading grid`);
      if (width >= 1280) {
        if (!geometry.toc) fail(`article-layout/${label}: TOC missing on wide desktop`);
        else if (geometry.toc.left < geometry.content.right - 2) fail(`article-layout/${label}: TOC overlaps or precedes article column`);
      } else if (geometry.toc && geometry.toc.bottom > geometry.content.top + 2) {
        fail(`article-layout/${label}: pre-breakpoint TOC is not above article content`);
      }
    } finally {
      await context.close();
    }
  }
  const before = samples.find(sample => sample.label === "pre-breakpoint")?.geometry?.article?.width;
  const after = samples.find(sample => sample.label === "breakpoint")?.geometry?.article?.width;
  if (before && after && after < before * 0.9) fail(`article-layout/breakpoint: article width drops from ${before.toFixed(1)}px to ${after.toFixed(1)}px at 1280px`);
  report.layout.article = samples;
}

async function captureVisualEvidence(browser) {
  const screenshotDir = path.join(OUT_DIR, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  for (const [routeName, routePath] of VISUAL_ROUTES) {
    for (const [viewportName, width, height] of VIEWPORTS) {
      for (const colorScheme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: "reduce" });
        const page = await context.newPage();
        try {
          const response = await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
          if (!response?.ok()) fail(`visual/${routeName}/${viewportName}/${colorScheme}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
          const actualDark = await ensureTheme(page, colorScheme, `visual/${routeName}/${viewportName}/${colorScheme}`);
          const fileName = `${routeName}-${viewportName}-${colorScheme}.png`;
          await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
          report.visualEvidence.push({ route: routePath, viewport: viewportName, colorScheme, actualDark, screenshot: `screenshots/${fileName}` });
        } finally {
          await context.close();
        }
      }
    }
  }
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await verifyLineage();

  for (const [browserName, browserType] of Object.entries(BROWSERS)) {
    report.browsers[browserName] = { smoke: [], axe: [], keyboard: [] };
    const browser = await browserType.launch({ headless: true });
    try {
      for (const [routeName, routePath] of ROUTES) {
        for (const [viewportName, width, height] of VIEWPORTS) await smoke(browserName, browser, routeName, routePath, viewportName, width, height);
      }
      for (const [routeName, routePath] of AXE_ROUTES) {
        for (const colorScheme of ["light", "dark"]) await axeAudit(browserName, browser, routeName, routePath, colorScheme);
      }
      for (const [routeName, routePath] of [["home", "/"], ["long-article", "/posts/first-hackathon/"]]) {
        await keyboardAndTargets(browserName, browser, routeName, routePath);
      }
      if (browserName === "chromium") {
        await verifyArticleLayout(browser);
        await captureVisualEvidence(browser);
      }
    } finally {
      await browser.close();
    }
  }

  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length) {
    console.error(`Weekly cross-browser accessibility QA: FAIL (${report.failures.length} issue(s))`);
    process.exit(1);
  }
  console.log("Weekly cross-browser accessibility QA: PASS (Chromium + Firefox + WebKit, responsive smoke + WCAG A/AA + keyboard + target size + desktop article geometry + rendered light/dark screenshots)");
}

main().catch(async error => {
  console.error(error);
  report.finishedAt = new Date().toISOString();
  report.failures.push(String(error?.stack || error));
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  process.exit(1);
});