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
const ARTICLE_VIEWPORTS = [["pre-breakpoint", 1279, 900], ["breakpoint", 1280, 900], ["desktop", 1440, 1000], ["wide-desktop", 1600, 1000]];
const SCHEMES = ["light", "dark"];
const failures = [];
const report = {
  baseUrl: BASE_URL,
  expectedSourceSha: EXPECTED_SHA || null,
  startedAt: new Date().toISOString(),
  pages: [],
  interactions: {},
  media: {},
  alignment: {},
  layout: {},
};

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function navigate(page, routePath, label) {
  const response = await page.goto(`${BASE_URL}${routePath}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (!response?.ok()) {
    fail(`${label}: navigation failed (${response?.status() ?? "no response"})`);
  }
  // Reader QA must not require total network quiescence. Articles intentionally
  // contain lazy third-party comments and proxied media whose background
  // requests can keep a page non-idle. Dedicated checks below own those
  // components and wait for their explicit readiness instead.
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
  return response;
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
  if (actualDark !== desiredDark) {
    fail(`${label}: requested ${colorScheme} but html.dark=${actualDark}`);
  }
  return actualDark;
}

async function pageSnapshot(browser, routeName, routePath, viewportName, width, height, colorScheme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: "reduce" });
  const page = await context.newPage();
  const failedRequests = [];
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "failed"}`);
  });
  try {
    await navigate(page, routePath, `${routeName}/${viewportName}/${colorScheme}`);
    const actualDark = await ensureTheme(page, colorScheme, `${routeName}/${viewportName}/${colorScheme}`);
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const brokenImages = [...document.images]
        .filter(img => img.complete && img.naturalWidth === 0)
        .map(img => img.currentSrc || img.src || img.alt || "unknown");
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
    report.pages.push({
      route: routePath,
      name: routeName,
      viewport: viewportName,
      colorScheme,
      actualDark,
      metrics,
      failedRequests,
      screenshot: path.relative(OUT_DIR, screenshot),
    });
  } finally {
    await context.close();
  }
}

async function verifyListAlignment(browser, routePath, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await navigate(page, routePath, label);
    const geometry = await page.evaluate(() => {
      const heading = document.querySelector("main h1");
      const item = document.querySelector("main .article-link--card, main .article-link--simple");
      if (!heading || !item) return null;
      return {
        headingLeft: heading.getBoundingClientRect().left,
        itemLeft: item.getBoundingClientRect().left,
        itemVariant: item.classList.contains("article-link--card") ? "card" : "simple",
        delta: Math.abs(heading.getBoundingClientRect().left - item.getBoundingClientRect().left),
      };
    });
    report.alignment[label] = geometry;
    if (!geometry) fail(`${label}: unable to measure list heading/item alignment`);
    else if (geometry.delta > 2) fail(`${label}: heading/item left edges differ by ${geometry.delta.toFixed(2)}px`);
  } finally {
    await context.close();
  }
}

async function verifyInteractions(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await navigate(page, "/", "interactions/home");

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
      const searchGeometry = await page.evaluate(() => {
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
          buttonLeft: buttonRect.left,
          buttonRight: buttonRect.right,
          hintLeft: hintRect.left,
          hintRight: hintRect.right,
          hintWhiteSpace: getComputedStyle(hint).whiteSpace,
          hintText: (hint.textContent || "").trim(),
        };
      });
      report.interactions.searchButton = searchGeometry;
      if (!searchGeometry) fail("desktop search button geometry is unavailable");
      else {
        if (searchGeometry.scrollWidth > searchGeometry.clientWidth + 1) {
          fail(`desktop search button content overflows by ${(searchGeometry.scrollWidth - searchGeometry.clientWidth).toFixed(1)}px`);
        }
        if (searchGeometry.hintLeft < searchGeometry.buttonLeft - 1 || searchGeometry.hintRight > searchGeometry.buttonRight + 1) {
          fail("desktop search shortcut hint escapes button bounds");
        }
        if (searchGeometry.hintWhiteSpace !== "nowrap") {
          fail(`desktop search shortcut hint may wrap (${searchGeometry.hintWhiteSpace})`);
        }
      }

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
      await languageButton.hover();
      const languageLink = page.locator('a[href="/zh-cn/"]:visible').first();
      try {
        await languageLink.waitFor({ state: "visible", timeout: 5_000 });
      } catch {
        fail("zh-CN language link did not become visible after opening language menu");
      }
      if (await languageLink.count()) {
        await Promise.all([
          page.waitForURL(url => new URL(url).pathname.startsWith("/zh-cn/"), { timeout: 10_000 }).catch(() => {}),
          languageLink.click(),
        ]);
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        const simplifiedLabel = (await page.locator(".translation button:visible").first().innerText()).trim();
        report.interactions.languageLabels.simplified = simplifiedLabel;
        report.interactions.languageSwitch = { url: page.url() };
        if (simplifiedLabel !== "简体") fail(`Simplified language button label mismatch: ${simplifiedLabel || "EMPTY"}`);
        if (!new URL(page.url()).pathname.startsWith("/zh-cn/")) fail(`language switch did not reach zh-CN route: ${page.url()}`);
      }
    }
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
      await navigate(page, "/posts/first-hackathon/", `article-layout/${label}`);
      await page.locator(".article-reading-layout").waitFor({ state: "visible", timeout: 10_000 });
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
      if (geometry.article.width < 600 && width >= 1280) {
        fail(`article-layout/${label}: article column collapsed to ${geometry.article.width.toFixed(1)}px`);
      }
      if (geometry.footerInsideReading) {
        fail(`article-layout/${label}: post-reading footer remains inside TOC reading grid`);
      }
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
  if (before && after && after < before * 0.9) {
    fail(`article-layout/breakpoint: article width drops from ${before.toFixed(1)}px to ${after.toFixed(1)}px at 1280px`);
  }
  report.layout.article = samples;
}

async function verifyComments(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  try {
    await navigate(page, "/posts/first-hackathon/", "comments");
    const root = page.locator(".huikai-comments");
    try {
      await root.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      fail("public article does not expose the HUIKAI comments surface");
      return;
    }
    const state = await page.evaluate(() => {
      const comments = document.querySelector(".huikai-comments");
      const commentsOuter = comments?.closest(".article-footer");
      const reading = document.querySelector(".article-reading-content");
      const reference = [...document.querySelectorAll(".article-footer")]
        .filter(element => element !== commentsOuter)
        .at(-1);
      const commentsInsideReading = Boolean(document.querySelector(".article-reading-layout .huikai-comments"));
      const rect = element => {
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, width: value.width };
      };
      const controls = [
        document.querySelector("[data-comments-name]"),
        document.querySelector("[data-comments-body]"),
        document.querySelector("[data-comments-submit]"),
      ].map(element => element?.getBoundingClientRect().height || 0);
      return {
        key: comments?.dataset.commentKey || "",
        api: comments?.dataset.apiBase || "",
        giscusScripts: document.querySelectorAll('script[src^="https://giscus.app/client.js"]').length,
        giscusFrames: document.querySelectorAll("iframe.giscus-frame").length,
        comments: rect(commentsOuter),
        reference: rect(reference),
        reading: rect(reading),
        commentsInsideReading,
        minControlHeight: Math.min(...controls),
        overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    report.interactions.comments = { provider: "huikai", ...state };
    if (!state.key.startsWith("notion:")) fail(`HUIKAI comments key is invalid: ${state.key || "EMPTY"}`);
    if (state.api !== "/api/comments/v1") fail(`HUIKAI comments API contract drifted: ${state.api || "EMPTY"}`);
    if (state.giscusScripts !== 0 || state.giscusFrames !== 0) fail("production article unexpectedly loads Giscus alongside HUIKAI comments");
    if (!state.comments || !state.reference) {
      fail("comments layout: unable to measure HUIKAI comments/article-footer alignment");
    } else {
      const leftDelta = Math.abs(state.comments.left - state.reference.left);
      const rightDelta = Math.abs(state.comments.right - state.reference.right);
      if (leftDelta > 2 || rightDelta > 2) {
        fail(`comments layout: HUIKAI comments differ from article footer by left=${leftDelta.toFixed(2)}px right=${rightDelta.toFixed(2)}px`);
      }
    }
    if (!state.reading) fail("comments layout: article reading content anchor is missing");
    if (state.commentsInsideReading) fail("comments layout: HUIKAI comments remain inside the TOC reading grid");
    if (state.minControlHeight < 44) fail(`HUIKAI comments interactive target is too small (${state.minControlHeight.toFixed(1)}px)`);
    if (state.overflowX > 1) fail(`HUIKAI comments introduce horizontal overflow (${state.overflowX.toFixed(1)}px)`);
  } finally {
    await context.close();
  }
}

async function verifyFooterLayout(browser) {
  for (const [viewportName, width, height] of [["desktop", 1200, 900], ["mobile", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    try {
      await navigate(page, "/posts/first-hackathon/", `footer/${viewportName}`);
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
    } finally {
      await context.close();
    }
  }
}

async function verifyMedia(browser, routePath, selector, label, expectedMimePrefix) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  try {
    await navigate(page, routePath, `media/${label}`);
    const media = page.locator(selector).first();
    if (!(await media.count())) {
      fail(`${label}: ${selector} element missing`);
      return;
    }
    const endpoint = await media.getAttribute("data-media-endpoint");
    if (!endpoint) {
      fail(`${label}: data-media-endpoint missing`);
      return;
    }
    try {
      await page.waitForFunction(selectorText => {
        const el = document.querySelector(selectorText);
        return el && el.currentSrc && el.readyState >= 1 && Number.isFinite(el.duration) && el.duration > 0;
      }, selector, { timeout: 15_000 });
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
    if (!range.receivedBytes) fail(`${label}: Range response body is empty`);
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await verifySourceLineage();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [routeName, routePath] of ROUTES) {
      for (const [viewportName, width, height] of VIEWPORTS) {
        for (const scheme of SCHEMES) {
          await pageSnapshot(browser, routeName, routePath, viewportName, width, height, scheme);
        }
      }
    }
    await verifyListAlignment(browser, "/posts/", "posts");
    await verifyListAlignment(browser, "/projects/", "projects");
    await verifyInteractions(browser);
    await verifyArticleLayout(browser);
    await verifyComments(browser);
    await verifyFooterLayout(browser);
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
  console.log(`Live reader QA: PASS (${report.pages.length} rendered states + alignment + desktop article geometry + layout + interactions + media)`);
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