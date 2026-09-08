#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const EXPECTED_SHA = (process.env.EXPECTED_SOURCE_SHA || "").trim();
const OUT_DIR = path.resolve(process.env.LIVE_QA_OUTPUT || "live-reader-qa");
const ROUTES = [
  ["home", "/"], ["posts", "/posts/"], ["projects", "/projects/"], ["explore", "/explore/"],
  ["about", "/about/"], ["site-log", "/site-log/"],
  ["hackathon-video", "/posts/first-hackathon/"],
  ["audio-article", "/posts/how-to-make-wealth/"],
];
const VIEWPORTS = [["desktop", 1440, 1000], ["mobile", 390, 844]];
const SCHEMES = ["light", "dark"];
const failures = [];
const report = { baseUrl: BASE_URL, expectedSourceSha: EXPECTED_SHA || null, startedAt: new Date().toISOString(), pages: [], interactions: {}, media: {}, alignment: {}, layout: {} };

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function verifySourceLineage() {
  const response = await fetch(`${BASE_URL}/source-commit.txt`, { redirect: "follow" });
  if (!response.ok) fail(`source lineage: HTTP ${response.status}`);
  const actual = (await response.text()).trim();
  report.actualSourceSha = actual;
  if (EXPECTED_SHA && actual !== EXPECTED_SHA) fail(`live source SHA mismatch: expected=${EXPECTED_SHA}, actual=${actual}`);
}

async function pageSnapshot(browser, routeName, routePath, viewportName, width, height, colorScheme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: "reduce" });
  const page = await context.newPage();
  const failedRequests = [];
  page.on("requestfailed", request => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "failed"}`));
  const response = await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "networkidle", timeout: 45_000 });
  if (!response || !response.ok()) fail(`${routeName}/${viewportName}/${colorScheme}: navigation failed (${response?.status() ?? "no response"})`);
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const brokenImages = [...document.images].filter(img => img.complete && img.naturalWidth === 0).map(img => img.currentSrc || img.src || img.alt || "unknown");
    const text = (document.querySelector("main")?.innerText || document.body.innerText || "").trim();
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
  if (metrics.overflowX > 1) fail(`${routeName}/${viewportName}/${colorScheme}: horizontal overflow ${metrics.overflowX}px`);
  if (metrics.brokenImages.length) fail(`${routeName}/${viewportName}/${colorScheme}: broken images: ${metrics.brokenImages.join(", ")}`);
  if (metrics.bodyTextLength < 20) fail(`${routeName}/${viewportName}/${colorScheme}: page content appears empty`);
  if (metrics.h1Count !== 1) fail(`${routeName}/${viewportName}/${colorScheme}: expected exactly one H1, got ${metrics.h1Count}`);
  const screenshotDir = path.join(OUT_DIR, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshot = path.join(screenshotDir, `${routeName}-${viewportName}-${colorScheme}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  report.pages.push({ route: routePath, name: routeName, viewport: viewportName, colorScheme, metrics, failedRequests, screenshot: path.relative(OUT_DIR, screenshot) });
  await context.close();
}

async function verifyListAlignment(browser, routePath, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "networkidle", timeout: 45_000 });
  const geometry = await page.evaluate(() => {
    const heading = document.querySelector("main h1");
    const card = document.querySelector("main .article-link--card");
    if (!heading || !card) return null;
    return {
      headingLeft: heading.getBoundingClientRect().left,
      cardLeft: card.getBoundingClientRect().left,
      delta: Math.abs(heading.getBoundingClientRect().left - card.getBoundingClientRect().left),
    };
  });
  report.alignment[label] = geometry;
  if (!geometry) fail(`${label}: unable to measure list heading/card alignment`);
  else if (geometry.delta > 2) fail(`${label}: heading/card left edges differ by ${geometry.delta.toFixed(2)}px`);
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

  const languageButton = page.locator(".translation button:visible").first();
  if (!(await languageButton.count())) fail("visible language menu button is missing");
  else {
    const traditionalLabel = (await languageButton.innerText()).trim();
    report.interactions.languageLabels = { traditional: traditionalLabel };
    if (traditionalLabel !== "繁體") fail(`Traditional language button label mismatch: ${traditionalLabel || "EMPTY"}`);
    await languageButton.click();
    const languageLink = page.locator('a[href="/zh-cn/"]:visible').first();
    try { await languageLink.waitFor({ state: "visible", timeout: 5_000 }); }
    catch { fail("zh-CN language link did not become visible after opening language menu"); }
    if (await languageLink.count()) {
      await languageLink.click();
      await page.waitForLoadState("networkidle");
      const simplifiedLabel = (await page.locator(".translation button:visible").first().innerText()).trim();
      report.interactions.languageLabels.simplified = simplifiedLabel;
      report.interactions.languageSwitch = { url: page.url() };
      if (simplifiedLabel !== "简体") fail(`Simplified language button label mismatch: ${simplifiedLabel || "EMPTY"}`);
      if (!new URL(page.url()).pathname.startsWith("/zh-cn/")) fail(`language switch did not reach zh-CN route: ${page.url()}`);
    }
  }
  await context.close();
}

async function verifyComments(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/posts/first-hackathon/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const scriptCount = await page.locator('script[src^="https://giscus.app/client.js"]').count();
  let iframeLoaded = false;
  try { await page.locator("iframe.giscus-frame").waitFor({ state: "attached", timeout: 10_000 }); iframeLoaded = true; } catch {}
  const geometry = await page.evaluate(() => {
    const comments = document.querySelector(".giscus-comments");
    const commentsOuter = comments?.closest(".article-footer");
    const candidates = [...document.querySelectorAll("main .article-footer")].filter(element => element !== commentsOuter);
    const reference = candidates.at(-1);
    if (!commentsOuter || !reference) return null;
    const commentsRect = commentsOuter.getBoundingClientRect();
    const referenceRect = reference.getBoundingClientRect();
    return {
      commentsLeft: commentsRect.left,
      commentsRight: commentsRect.right,
      referenceLeft: referenceRect.left,
      referenceRight: referenceRect.right,
      leftDelta: Math.abs(commentsRect.left - referenceRect.left),
      rightDelta: Math.abs(commentsRect.right - referenceRect.right),
    };
  });
  report.interactions.comments = { giscusScriptCount: scriptCount, iframeLoaded, geometry };
  if (scriptCount !== 1) fail("public article does not expose exactly one Giscus client script");
  if (!geometry) fail("comments layout: unable to measure Giscus/article-footer alignment");
  else if (geometry.leftDelta > 2 || geometry.rightDelta > 2)
    fail(`comments layout: Giscus container differs from article footer by left=${geometry.leftDelta.toFixed(2)}px right=${geometry.rightDelta.toFixed(2)}px`);
  await context.close();
}

async function verifyFooterLayout(browser) {
  for (const [viewportName, width, height] of [["desktop", 1200, 900], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/posts/first-hackathon/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const geometry = await page.evaluate(() => {
      const row = document.querySelector("#site-footer > div");
      const copyright = row?.querySelector("p");
      const nav = row?.querySelector("nav");
      if (!row || !copyright || !nav) return null;
      const rowStyle = getComputedStyle(row);
      const copyrightRect = copyright.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      return {
        flexDirection: rowStyle.flexDirection,
        copyrightLeft: copyrightRect.left,
        copyrightTop: copyrightRect.top,
        copyrightRight: copyrightRect.right,
        navLeft: navRect.left,
        navTop: navRect.top,
        navRight: navRect.right,
        verticalDelta: Math.abs(copyrightRect.top - navRect.top),
      };
    });
    report.layout[`footer-${viewportName}`] = geometry;
    if (!geometry) fail(`footer/${viewportName}: unable to measure copyright/menu layout`);
    else if (viewportName === "desktop") {
      if (geometry.flexDirection !== "row") fail(`footer/desktop: expected row layout, got ${geometry.flexDirection}`);
      if (geometry.navLeft <= geometry.copyrightRight) fail("footer/desktop: site-log link is not positioned to the right of copyright");
      if (geometry.verticalDelta > 4) fail(`footer/desktop: copyright/menu top edges differ by ${geometry.verticalDelta.toFixed(2)}px`);
    } else {
      if (geometry.flexDirection !== "column") fail(`footer/mobile: expected column layout, got ${geometry.flexDirection}`);
      if (geometry.navTop < geometry.copyrightTop) fail("footer/mobile: site-log link appears before copyright");
    }
    await context.close();
  }
}

async function verifyMedia(browser, routePath, selector, label, expectedMimePrefix) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const media = page.locator(selector).first();
  if (!(await media.count())) { fail(`${label}: ${selector} element missing`); await context.close(); return; }
  const endpoint = await media.getAttribute("data-media-endpoint");
  if (!endpoint) { fail(`${label}: data-media-endpoint missing`); await context.close(); return; }
  try {
    await page.waitForFunction(selectorText => {
      const el = document.querySelector(selectorText);
      return el && el.currentSrc && el.readyState >= 1 && Number.isFinite(el.duration) && el.duration > 0;
    }, selector, { timeout: 15_000 });
  } catch { fail(`${label}: browser did not load playable metadata within 15s`); }
  const browserState = await media.evaluate(el => ({ currentSrc: el.currentSrc, readyState: el.readyState, networkState: el.networkState, duration: Number.isFinite(el.duration) ? el.duration : null, errorCode: el.error?.code || null }));
  if (!(browserState.duration > 0)) fail(`${label}: duration is unavailable after metadata load`);
  if (browserState.errorCode) fail(`${label}: HTMLMediaElement error code ${browserState.errorCode}`);
  const range = await page.evaluate(async endpointValue => {
    const response = await fetch(endpointValue, { credentials: "same-origin", headers: { Range: "bytes=0-1023" }, redirect: "follow" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, finalUrl: response.url, contentType: response.headers.get("content-type") || "", contentRange: response.headers.get("content-range") || "", acceptRanges: response.headers.get("accept-ranges") || "", receivedBytes: bytes.length };
  }, endpoint);
  report.media[label] = { endpoint, browserState, range };
  if (range.status !== 206) fail(`${label}: expected Range status 206, got ${range.status}`);
  if (!range.contentType.toLowerCase().startsWith(expectedMimePrefix)) fail(`${label}: unexpected MIME ${range.contentType || "missing"}`);
  if (!/^bytes\s+\d+-\d+\/\d+$/i.test(range.contentRange)) fail(`${label}: invalid Content-Range ${range.contentRange || "missing"}`);
  if (!range.receivedBytes) fail(`${label}: Range response body is empty`);
  await context.close();
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await verifySourceLineage();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [routeName, routePath] of ROUTES)
      for (const [viewportName, width, height] of VIEWPORTS)
        for (const scheme of SCHEMES) await pageSnapshot(browser, routeName, routePath, viewportName, width, height, scheme);
    await verifyListAlignment(browser, "/posts/", "posts");
    await verifyListAlignment(browser, "/projects/", "projects");
    await verifyInteractions(browser);
    await verifyComments(browser);
    await verifyFooterLayout(browser);
    await verifyMedia(browser, "/posts/how-to-make-wealth/", "audio.notion-audio", "audio", "audio/");
    await verifyMedia(browser, "/posts/first-hackathon/", "video.notion-video", "video", "video/");
  } finally { await browser.close(); }
  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) { console.error(`Live reader QA: FAIL (${failures.length} issue(s))`); process.exit(1); }
  console.log(`Live reader QA: PASS (${report.pages.length} rendered states + alignment + layout + interactions + media)`);
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
