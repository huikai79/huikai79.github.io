#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const EXPECTED_SHA = (process.env.EXPECTED_SOURCE_SHA || "").trim();
const OUT_DIR = path.resolve(process.env.LIVE_QA_OUTPUT || "live-reader-qa");

const ROUTES = [
  { name: "home", path: "/" },
  { name: "posts", path: "/posts/" },
  { name: "explore", path: "/explore/" },
  { name: "about", path: "/about/" },
  { name: "site-log", path: "/site-log/" },
  { name: "hackathon-video", path: "/posts/first-hackathon/" },
  { name: "audio-article", path: "/posts/how-to-make-wealth/" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const SCHEMES = ["light", "dark"];
const failures = [];
const report = {
  baseUrl: BASE_URL,
  expectedSourceSha: EXPECTED_SHA || null,
  startedAt: new Date().toISOString(),
  pages: [],
  interactions: {},
  media: {},
};

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function verifySourceLineage() {
  const response = await fetch(`${BASE_URL}/source-commit.txt`, { redirect: "follow" });
  if (!response.ok) fail(`source lineage: HTTP ${response.status}`);
  const actual = (await response.text()).trim();
  report.actualSourceSha = actual;
  if (EXPECTED_SHA && actual !== EXPECTED_SHA) {
    fail(`live source SHA mismatch: expected=${EXPECTED_SHA}, actual=${actual}`);
  }
}

async function pageSnapshot(browser, route, viewport, colorScheme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const failedRequests = [];
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "failed"}`);
  });

  const response = await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "networkidle", timeout: 45_000 });
  if (!response || !response.ok()) {
    fail(`${route.name}/${viewport.name}/${colorScheme}: navigation failed (${response?.status() ?? "no response"})`);
  }

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const brokenImages = [...document.images]
      .filter(img => img.complete && img.naturalWidth === 0)
      .map(img => img.currentSrc || img.src || img.alt || "unknown");
    const main = document.querySelector("main");
    const text = (main?.innerText || document.body.innerText || "").trim();
    return {
      title: document.title,
      h1Count: document.querySelectorAll("h1").length,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      overflowX: Math.max(0, root.scrollWidth - root.clientWidth),
      brokenImages,
      bodyTextLength: text.length,
      lang: root.lang || "",
    };
  });

  if (metrics.overflowX > 1) fail(`${route.name}/${viewport.name}/${colorScheme}: horizontal overflow ${metrics.overflowX}px`);
  if (metrics.brokenImages.length) fail(`${route.name}/${viewport.name}/${colorScheme}: broken images: ${metrics.brokenImages.join(", ")}`);
  if (metrics.bodyTextLength < 20) fail(`${route.name}/${viewport.name}/${colorScheme}: page content appears empty`);
  if (metrics.h1Count !== 1) fail(`${route.name}/${viewport.name}/${colorScheme}: expected exactly one H1, got ${metrics.h1Count}`);

  const screenshotDir = path.join(OUT_DIR, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshot = path.join(screenshotDir, `${route.name}-${viewport.name}-${colorScheme}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  report.pages.push({ route: route.path, name: route.name, viewport: viewport.name, colorScheme, metrics, failedRequests, screenshot: path.relative(OUT_DIR, screenshot) });
  await context.close();
}

async function verifyInteractions(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 45_000 });

  const switcher = page.locator("#appearance-switcher");
  if (!(await switcher.count())) fail("desktop appearance switcher is missing");
  else {
    const before = await page.locator("html").evaluate(el => el.classList.contains("dark"));
    await switcher.click();
    await page.waitForTimeout(250);
    const after = await page.locator("html").evaluate(el => el.classList.contains("dark"));
    report.interactions.themeToggle = { beforeDark: before, afterDark: after };
    if (before === after) fail("theme switcher did not toggle html.dark state");
  }

  const searchButton = page.locator("#search-button");
  if (!(await searchButton.count())) fail("desktop search button is missing");
  else {
    await searchButton.click();
    const wrapper = page.locator("#search-wrapper");
    await wrapper.waitFor({ state: "visible", timeout: 5_000 });
    const query = page.locator("#search-query");
    await query.fill("Hackathon");
    await page.waitForTimeout(600);
    report.interactions.search = { wrapperVisible: await wrapper.isVisible(), queryValue: await query.inputValue() };
    if ((await query.inputValue()) !== "Hackathon") fail("search input did not accept text");
    await page.keyboard.press("Escape");
  }

  const languageLink = page.locator('a[href="/zh-cn/"]').first();
  if (!(await languageLink.count())) fail("zh-CN language switch link is missing");
  else {
    await languageLink.click();
    await page.waitForLoadState("networkidle");
    report.interactions.languageSwitch = { url: page.url() };
    if (!new URL(page.url()).pathname.startsWith("/zh-cn/")) fail(`language switch did not reach zh-CN route: ${page.url()}`);
  }
  await context.close();
}

async function verifyComments(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/posts/first-hackathon/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const scriptCount = await page.locator('script[src^="https://giscus.app/client.js"]').count();
  let iframeLoaded = false;
  try {
    await page.locator("iframe.giscus-frame").waitFor({ state: "attached", timeout: 10_000 });
    iframeLoaded = true;
  } catch {}
  report.interactions.comments = { giscusScriptCount: scriptCount, iframeLoaded };
  if (scriptCount !== 1) fail("public article does not expose exactly one Giscus client script");
  await context.close();
}

async function verifyMedia(browser, routePath, selector, label, expectedMimePrefix) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const media = page.locator(selector).first();
  if (!(await media.count())) {
    fail(`${label}: ${selector} element missing`);
    await context.close();
    return;
  }

  const endpoint = await media.getAttribute("data-media-endpoint");
  if (!endpoint) {
    fail(`${label}: data-media-endpoint missing`);
    await context.close();
    return;
  }

  try {
    await page.waitForFunction(
      selectorText => {
        const el = document.querySelector(selectorText);
        return el && el.currentSrc && el.readyState >= 1 && Number.isFinite(el.duration) && el.duration > 0;
      },
      selector,
      { timeout: 15_000 }
    );
  } catch {
    fail(`${label}: browser did not load playable metadata within 15s`);
  }

  const browserState = await media.evaluate(el => ({
    currentSrc: el.currentSrc,
    readyState: el.readyState,
    networkState: el.networkState,
    duration: Number.isFinite(el.duration) ? el.duration : null,
    errorCode: el.error?.code || null,
  }));
  if (!(browserState.duration > 0)) fail(`${label}: duration is unavailable after metadata load`);
  if (browserState.errorCode) fail(`${label}: HTMLMediaElement error code ${browserState.errorCode}`);

  const range = await page.evaluate(async endpointValue => {
    const response = await fetch(endpointValue, {
      credentials: "same-origin",
      headers: { Range: "bytes=0-1023" },
      redirect: "follow",
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") || "",
      contentRange: response.headers.get("content-range") || "",
      acceptRanges: response.headers.get("accept-ranges") || "",
      receivedBytes: bytes.length,
    };
  }, endpoint);

  report.media[label] = { endpoint, browserState, range };
  if (range.status !== 206) fail(`${label}: expected Range status 206, got ${range.status}`);
  if (!range.contentType.toLowerCase().startsWith(expectedMimePrefix)) fail(`${label}: unexpected MIME ${range.contentType || "missing"}`);
  if (!/^bytes\s+\d+-\d+\/\d+$/i.test(range.contentRange)) fail(`${label}: invalid Content-Range ${range.contentRange || "missing"}`);
  if (!/bytes/i.test(range.acceptRanges)) fail(`${label}: Accept-Ranges does not advertise bytes`);
  if (!range.receivedBytes) fail(`${label}: Range response body is empty`);
  await context.close();
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await verifySourceLineage();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        for (const scheme of SCHEMES) await pageSnapshot(browser, route, viewport, scheme);
      }
    }
    await verifyInteractions(browser);
    await verifyComments(browser);
    await verifyMedia(browser, "/posts/how-to-make-wealth/", "audio.notion-audio", "audio", "audio/");
    await verifyMedia(browser, "/posts/first-hackathon/", "video.notion-video", "video", "video/");
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) {
    console.error(`Live reader QA: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }
  console.log(`Live reader QA: PASS (${report.pages.length} rendered states + interactions + media)`);
}

main().catch(async error => {
  console.error(error);
  try {
    await fs.mkdir(OUT_DIR, { recursive: true });
    report.finishedAt = new Date().toISOString();
    report.failures = [...failures, String(error?.stack || error)];
    await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  } catch {}
  process.exit(1);
});
