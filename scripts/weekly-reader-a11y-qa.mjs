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
const BROWSERS = { chromium, firefox, webkit };
const AXE_ROUTES = [["home", "/"], ["long-article", "/posts/first-hackathon/"], ["zh-cn-article", "/zh-cn/posts/how-you-know/"]];
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const report = { baseUrl: BASE_URL, expectedSourceSha: EXPECTED_SHA || null, startedAt: new Date().toISOString(), browsers: {}, failures: [] };

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
    report.browsers[browserName].keyboard.push({ route: routePath, focusTrail, targetCount: targets.length, undersized });
  } finally {
    await context.close();
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
  console.log("Weekly cross-browser accessibility QA: PASS (Chromium + Firefox + WebKit, responsive smoke + WCAG A/AA + keyboard + target size)");
}

main().catch(async error => {
  console.error(error);
  report.finishedAt = new Date().toISOString();
  report.failures.push(String(error?.stack || error));
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  process.exit(1);
});
