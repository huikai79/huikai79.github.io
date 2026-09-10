#!/usr/bin/env node
import process from "node:process";
import { chromium, firefox, webkit } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const LONG_ROUTE = "/posts/how-to-make-wealth/";
const SHORT_ROUTE = "/posts/first-hackathon/";
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function waitForProgress(page, expected, tolerance = 0.08) {
  await page.waitForFunction(
    ({ expected, tolerance }) => {
      const bar = document.querySelector("#reading-progress");
      if (!bar) return false;
      const value = Number.parseFloat(bar.dataset.progress || "NaN");
      return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
    },
    { expected, tolerance },
    { timeout: 3_000 },
  ).catch(() => {});
}

async function openRoute(page, route) {
  const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
  return response;
}

async function verifyCjkTypography(browserType, label) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await openRoute(page, LONG_ROUTE);
    if (!response?.ok()) return fail(`${label}: CJK typography route failed (${response?.status() ?? "no response"})`);
    const state = await page.evaluate(() => {
      const article = document.querySelector(".article-main");
      const heading = article?.querySelector("h2");
      const paragraph = [...(article?.querySelectorAll("p:not(.article-date-line):not(.article-summary)") || [])].find(
        p => /[\u3400-\u9fff]/u.test(p.textContent || "") && (p.textContent || "").trim().length >= 20,
      );
      if (!article || !heading || !paragraph) return null;
      const articleStyle = getComputedStyle(article);
      const headingStyle = getComputedStyle(heading);
      const paragraphStyle = getComputedStyle(paragraph);
      return {
        lang: document.documentElement.lang,
        lineBreak: articleStyle.lineBreak,
        headingTextWrap: headingStyle.textWrap || "",
        headingTextWrapStyle: headingStyle.textWrapStyle || "",
        paragraphFontSize: Number.parseFloat(paragraphStyle.fontSize || "0"),
        paragraphLineHeight: Number.parseFloat(paragraphStyle.lineHeight || "0"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    if (!state) return fail(`${label}: CJK article elements missing`);
    if (state.lang.toLowerCase() !== "zh-tw") fail(`${label}: document language drifted (${state.lang || "missing"})`);
    if (state.lineBreak !== "strict") fail(`${label}: expected line-break: strict, got ${state.lineBreak || "unknown"}`);
    if (![state.headingTextWrap, state.headingTextWrapStyle].some(value => String(value).includes("balance"))) {
      fail(`${label}: balanced heading wrapping not active (${state.headingTextWrap}/${state.headingTextWrapStyle})`);
    }
    if (state.paragraphFontSize < 16) fail(`${label}: CJK body font size fell below 16px (${state.paragraphFontSize}px)`);
    if (state.paragraphLineHeight < state.paragraphFontSize * 1.6) {
      fail(`${label}: CJK paragraph line-height is too tight (${state.paragraphLineHeight}px for ${state.paragraphFontSize}px text)`);
    }
    if (state.overflow > 1) fail(`${label}: CJK typography introduced horizontal overflow (${state.overflow}px)`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await openRoute(page, LONG_ROUTE);
    if (!response?.ok()) return fail(`longform desktop: HTTP ${response?.status() ?? "NO_RESPONSE"}`);

    const initial = await page.evaluate(() => {
      const article = document.querySelector(".article-main");
      const bar = document.querySelector("#reading-progress");
      const toc = document.querySelector("#TableOfContents");
      const heading = article?.querySelector("h2");
      const headingAnchor = heading?.querySelector(".anchor");
      const headingPermalink = heading?.querySelector('a[href^="#"]');
      const paragraph = [...(article?.querySelectorAll("p:not(.article-date-line):not(.article-summary)") || [])].find(
        p => /[\u3400-\u9fff]/u.test(p.textContent || "") && (p.textContent || "").trim().length >= 20,
      );
      if (!article || !bar || !toc || !heading || !paragraph) return null;
      const articleRect = article.getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      const paragraphStyle = getComputedStyle(paragraph);
      const barRect = bar.getBoundingClientRect();
      const barStyle = getComputedStyle(bar);
      const h2Style = getComputedStyle(heading);
      const h3 = article.querySelector("h3");
      const h3Style = h3 ? getComputedStyle(h3) : null;
      return {
        articleHeight: articleRect.height,
        viewportHeight: window.innerHeight,
        barHeight: barRect.height,
        barTop: barRect.top,
        barPosition: barStyle.position,
        pointerEvents: barStyle.pointerEvents,
        paragraphWidth: paragraphRect.width,
        paragraphFontSize: Number.parseFloat(paragraphStyle.fontSize || "0"),
        paragraphLineHeight: Number.parseFloat(paragraphStyle.lineHeight || "0"),
        h2MarginTop: Number.parseFloat(h2Style.marginTop || "0"),
        h3MarginTop: h3Style ? Number.parseFloat(h3Style.marginTop || "0") : null,
        hasHeadingAnchor: Boolean(headingAnchor),
        hasHeadingPermalink: Boolean(headingPermalink),
      };
    });

    if (!initial) return fail("longform desktop: required article/progress/TOC/heading/body-paragraph elements missing");
    if (initial.articleHeight < initial.viewportHeight * 2) fail(`longform desktop: test article is too short (${initial.articleHeight.toFixed(1)}px)`);
    if (initial.barPosition !== "fixed" || Math.abs(initial.barTop) > 1) fail(`longform desktop: progress bar is not fixed at viewport top (${initial.barPosition}, top=${initial.barTop.toFixed(1)})`);
    if (Math.abs(initial.barHeight - 2) > 0.6) fail(`longform desktop: progress bar height is ${initial.barHeight.toFixed(1)}px, expected ~2px`);
    if (initial.pointerEvents !== "none") fail(`longform desktop: progress bar must not intercept input (${initial.pointerEvents})`);
    if (!initial.hasHeadingAnchor || !initial.hasHeadingPermalink) fail("longform desktop: native Blowfish heading permalink/anchor was lost");
    if (initial.h2MarginTop < 40) fail(`longform desktop: H2 breathing space is too small (${initial.h2MarginTop.toFixed(1)}px)`);
    if (initial.h3MarginTop !== null && initial.h3MarginTop < 30) fail(`longform desktop: H3 breathing space is too small (${initial.h3MarginTop.toFixed(1)}px)`);

    const cjkLineCapacity = initial.paragraphFontSize > 0 ? initial.paragraphWidth / initial.paragraphFontSize : 0;
    console.log(`longform desktop: readable-width diagnostic ≈${cjkLineCapacity.toFixed(1)} CJK-em per line, body=${initial.paragraphFontSize.toFixed(1)}px/${initial.paragraphLineHeight.toFixed(1)}px`);
    if (cjkLineCapacity < 24 || cjkLineCapacity > 52) fail(`longform desktop: rendered CJK line capacity is outside the review band (${cjkLineCapacity.toFixed(1)} em)`);
    if (initial.paragraphLineHeight < initial.paragraphFontSize * 1.45) fail(`longform desktop: paragraph line-height is too tight (${initial.paragraphLineHeight.toFixed(1)}px for ${initial.paragraphFontSize.toFixed(1)}px text)`);

    const midpointScroll = await page.evaluate(() => {
      const article = document.querySelector(".article-main");
      const rect = article.getBoundingClientRect();
      return Math.max(0, rect.top + window.scrollY + rect.height * 0.5 - window.innerHeight * 0.33);
    });
    await page.evaluate(y => window.scrollTo(0, y), midpointScroll);
    await waitForProgress(page, 0.5);
    const midpoint = await page.evaluate(() => {
      const bar = document.querySelector("#reading-progress");
      return {
        progress: Number.parseFloat(bar?.dataset.progress || "NaN"),
        width: bar?.getBoundingClientRect().width || 0,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    if (!Number.isFinite(midpoint.progress) || Math.abs(midpoint.progress - 0.5) > 0.08) fail(`longform desktop: midpoint progress is ${midpoint.progress}, expected about 0.5`);
    const visualRatio = midpoint.viewportWidth > 0 ? midpoint.width / midpoint.viewportWidth : 0;
    if (Math.abs(visualRatio - midpoint.progress) > 0.03) fail(`longform desktop: visual progress width (${visualRatio.toFixed(3)}) disagrees with computed progress (${midpoint.progress.toFixed(3)})`);

    const laterHeading = await page.evaluate(() => {
      const headings = [...document.querySelectorAll(".article-main h2 .anchor")];
      const target = headings[Math.min(3, Math.max(0, headings.length - 1))];
      if (!target?.id) return null;
      return { id: target.id, y: Math.max(0, target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.33 + 8) };
    });
    if (!laterHeading) fail("longform desktop: unable to select a later heading for Smart TOC verification");
    else {
      await page.evaluate(y => window.scrollTo(0, y), laterHeading.y);
      await page.waitForTimeout(180);
      const active = await page.evaluate(() => {
        const link = document.querySelector("#TableOfContents a.active");
        if (!link) return null;
        const style = getComputedStyle(link);
        return { href: link.getAttribute("href"), fontWeight: Number.parseInt(style.fontWeight || "400", 10) };
      });
      if (!active || active.href !== `#${laterHeading.id}`) fail(`longform desktop: Smart TOC did not identify current section (expected #${laterHeading.id}, got ${active?.href || "none"})`);
      else if (active.fontWeight < 600) fail(`longform desktop: active TOC item is not visually distinguished enough (weight=${active.fontWeight})`);
    }

    const articleEndScroll = await page.evaluate(() => {
      const article = document.querySelector(".article-main");
      const rect = article.getBoundingClientRect();
      return Math.max(0, rect.bottom + window.scrollY - window.innerHeight * 0.33 + 4);
    });
    await page.evaluate(y => window.scrollTo(0, y), articleEndScroll);
    await waitForProgress(page, 1, 0.02);
    const endState = await page.evaluate(() => {
      const author = document.querySelector(".author-card");
      const bar = document.querySelector("#reading-progress");
      return {
        progress: Number.parseFloat(bar?.dataset.progress || "NaN"),
        authorTop: author ? author.getBoundingClientRect().top + window.scrollY : null,
        scrollY: window.scrollY,
        documentEndScroll: document.documentElement.scrollHeight - window.innerHeight,
      };
    });
    if (!Number.isFinite(endState.progress) || endState.progress < 0.98) fail(`longform desktop: progress does not complete at article end (${endState.progress})`);
    if (endState.authorTop && endState.scrollY >= endState.authorTop) fail("longform desktop: progress only completes after entering author/footer content");
    if (endState.scrollY >= endState.documentEndScroll - 20) fail("longform desktop: progress appears tied to whole-document scroll instead of article body");

    await page.emulateMedia({ media: "print" });
    const printDisplay = await page.locator("#reading-progress").evaluate(el => getComputedStyle(el).display);
    if (printDisplay !== "none") fail(`longform desktop: progress bar must be hidden in print media (display=${printDisplay})`);
  } finally {
    await context.close();
  }
}

async function verifyMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await openRoute(page, LONG_ROUTE);
    if (!response?.ok()) return fail(`longform mobile: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
    const state = await page.evaluate(() => {
      const article = document.querySelector(".article-main");
      const bar = document.querySelector("#reading-progress");
      const compactToc = document.querySelector(".article-toc .toc-inside");
      if (!article || !bar) return null;
      const articleRect = article.getBoundingClientRect();
      return {
        articleWidth: articleRect.width,
        viewportWidth: document.documentElement.clientWidth,
        rawOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        progressHeight: bar.getBoundingClientRect().height,
        compactTocVisible: compactToc ? getComputedStyle(compactToc).display !== "none" : false,
      };
    });
    if (!state) return fail("longform mobile: article/progress elements missing");
    if (state.rawOverflow > 1) fail(`longform mobile: horizontal overflow ${state.rawOverflow.toFixed(1)}px`);
    if (state.articleWidth > state.viewportWidth + 1) fail(`longform mobile: article width ${state.articleWidth.toFixed(1)}px exceeds viewport ${state.viewportWidth}px`);
    if (Math.abs(state.progressHeight - 2) > 0.6) fail(`longform mobile: progress bar height is ${state.progressHeight.toFixed(1)}px`);
    if (!state.compactTocVisible) fail("longform mobile: compact TOC should remain available for orientation");
  } finally {
    await context.close();
  }
}

async function verifyShortArticleStaysQuiet(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await openRoute(page, SHORT_ROUTE);
    if (!response?.ok()) return fail(`short article: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
    const progressCount = await page.locator("#reading-progress").count();
    if (progressCount !== 0) fail(`short article: reading progress should not render below the 8-minute threshold (count=${progressCount})`);
  } finally {
    await context.close();
  }
}

async function main() {
  await verifyCjkTypography(chromium, "Chromium");
  await verifyCjkTypography(firefox, "Firefox");
  await verifyCjkTypography(webkit, "WebKit");

  const browser = await chromium.launch({ headless: true });
  try {
    await verifyDesktop(browser);
    await verifyMobile(browser);
    await verifyShortArticleStaysQuiet(browser);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`Long-form reading verification: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }
  console.log("Long-form reading verification: PASS (article-only progress + 8-minute gate + print safety + Smart TOC orientation + native heading anchors + CJK strict line breaking + balanced headings + typography rhythm + mobile safety)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});