#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const CANONICAL_BASE_URL = (process.env.CANONICAL_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const EXPECTED_SHA = (process.env.EXPECTED_SOURCE_SHA || "").trim();
const OUT_DIR = path.resolve(process.env.MULTILINGUAL_QA_OUTPUT || "live-multilingual-route-qa");
const TRAD_PATH = "/posts/how-you-know/";
const SIMP_PATH = "/zh-cn/posts/how-you-know/";
const failures = [];
const report = {
  baseUrl: BASE_URL,
  canonicalBaseUrl: CANONICAL_BASE_URL,
  expectedSourceSha: EXPECTED_SHA || null,
  startedAt: new Date().toISOString(),
  direct: {},
  roundTrip: {},
};

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

function responseHeaders(response) {
  if (!response) return {};
  const headers = response.headers();
  return {
    status: response.status(),
    cacheControl: headers["cache-control"] || "",
    cfCacheStatus: headers["cf-cache-status"] || "",
    age: headers.age || "",
    server: headers.server || "",
    location: headers.location || "",
  };
}

async function inspectPage(page, expectedPath, expectedLang) {
  const expectedCanonical = `${CANONICAL_BASE_URL}${expectedPath}`;
  const state = await page.evaluate(() => ({
    path: location.pathname,
    href: location.href,
    lang: document.documentElement.lang || "",
    title: document.title,
    h1: document.querySelector("main h1")?.textContent?.trim() || "",
    canonical: document.querySelector('link[rel="canonical"]')?.href || "",
    refresh: document.querySelector('meta[http-equiv="refresh" i]')?.getAttribute("content") || "",
  }));
  if (state.path !== expectedPath) fail(`route mismatch: expected ${expectedPath}, got ${state.path}`);
  if (state.lang !== expectedLang) fail(`${expectedPath}: expected html lang ${expectedLang}, got ${state.lang || "EMPTY"}`);
  if (state.canonical !== expectedCanonical) fail(`${expectedPath}: canonical mismatch: expected ${expectedCanonical}, got ${state.canonical || "EMPTY"}`);
  if (state.refresh) fail(`${expectedPath}: unexpected meta refresh remains: ${state.refresh}`);
  return state;
}

async function openTranslationMenu(page) {
  const button = page.locator(".translation button:visible").first();
  if (!(await button.count())) {
    fail(`${new URL(page.url()).pathname}: visible translation menu button missing`);
    return false;
  }
  await button.click();
  return true;
}

async function translationLinkForPath(page, targetPath) {
  const links = page.locator(".translation a:visible");
  const count = await links.count();
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    const href = await link.getAttribute("href");
    if (!href) continue;
    const resolved = new URL(href, page.url());
    candidates.push({ href, path: resolved.pathname });
    if (resolved.pathname === targetPath) return { link, candidates };
  }
  return { link: null, candidates };
}

async function clickTranslationPath(page, targetPath) {
  if (!(await openTranslationMenu(page))) return false;
  const { link, candidates } = await translationLinkForPath(page, targetPath);
  if (!link) {
    fail(`${new URL(page.url()).pathname}: translation menu does not expose ${targetPath}; candidates=${JSON.stringify(candidates)}`);
    return false;
  }
  await Promise.all([
    page.waitForURL(url => url.pathname === targetPath, { timeout: 15_000 }),
    link.click(),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 45_000 });
  return true;
}

async function verifyDirectRoutes(browser) {
  for (const [label, routePath, lang] of [
    ["traditional", TRAD_PATH, "zh-TW"],
    ["simplified", SIMP_PATH, "zh-CN"],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const response = await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "networkidle", timeout: 45_000 });
    const state = await inspectPage(page, routePath, lang);
    const screenshot = path.join(OUT_DIR, `${label}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    report.direct[label] = { response: responseHeaders(response), state, screenshot: path.basename(screenshot) };
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const cacheBust = `audit=${Date.now()}`;
  const response = await page.goto(`${BASE_URL}${TRAD_PATH}?${cacheBust}`, { waitUntil: "networkidle", timeout: 45_000 });
  const state = await inspectPage(page, TRAD_PATH, "zh-TW");
  report.direct.traditionalCacheBust = { response: responseHeaders(response), state, query: cacheBust };
  await context.close();
}

async function verifyRoundTrip(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}${SIMP_PATH}`, { waitUntil: "networkidle", timeout: 45_000 });
  const simplifiedStart = await inspectPage(page, SIMP_PATH, "zh-CN");

  const reachedTraditional = await clickTranslationPath(page, TRAD_PATH);
  const traditionalMiddle = reachedTraditional
    ? await inspectPage(page, TRAD_PATH, "zh-TW")
    : await page.evaluate(() => ({ path: location.pathname, href: location.href, lang: document.documentElement.lang || "" }));

  const reachedSimplified = reachedTraditional ? await clickTranslationPath(page, SIMP_PATH) : false;
  const simplifiedEnd = reachedSimplified
    ? await inspectPage(page, SIMP_PATH, "zh-CN")
    : await page.evaluate(() => ({ path: location.pathname, href: location.href, lang: document.documentElement.lang || "" }));

  report.roundTrip = { simplifiedStart, traditionalMiddle, simplifiedEnd, reachedTraditional, reachedSimplified };
  await context.close();
}

async function verifyLineage() {
  if (!EXPECTED_SHA) return;
  const response = await fetch(`${BASE_URL}/source-commit.txt`, { redirect: "follow" });
  if (!response.ok) return fail(`source lineage: HTTP ${response.status}`);
  const actual = (await response.text()).trim();
  report.actualSourceSha = actual;
  if (actual !== EXPECTED_SHA) fail(`source lineage mismatch: expected=${EXPECTED_SHA}, actual=${actual}`);
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await verifyLineage();
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyDirectRoutes(browser);
    await verifyRoundTrip(browser);
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) {
    console.error(`Multilingual route QA: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }
  console.log("Multilingual route QA: PASS (direct zh-TW + zh-CN + cache-bust + article round-trip)");
}

main().catch(async error => {
  console.error(error);
  try {
    await fs.mkdir(OUT_DIR, { recursive: true, force: false });
    report.finishedAt = new Date().toISOString();
    report.failures = [...failures, String(error?.stack || error)];
    await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  } catch {}
  process.exit(1);
});
