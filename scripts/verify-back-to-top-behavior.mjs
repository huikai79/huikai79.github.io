#!/usr/bin/env node
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const TOC_ROUTE = "/posts/first-hackathon/";
const NO_TOC_ROUTE = "/posts/writing-and-speaking/";
const CASES = [
  ["mobile-toc", TOC_ROUTE, 390, 844, true],
  ["pre-breakpoint-toc", TOC_ROUTE, 1279, 900, true],
  ["desktop-toc", TOC_ROUTE, 1440, 1000, true],
  ["wide-desktop-toc", TOC_ROUTE, 1600, 1000, true],
  ["desktop-no-toc", NO_TOC_ROUTE, 1440, 900, false],
  ["wide-desktop-no-toc", NO_TOC_ROUTE, 1600, 900, false],
];
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function snapshot(page) {
  return page.evaluate(() => {
    const button = document.querySelector("#scroll-to-top");
    const footer = document.querySelector("#site-footer");
    const layoutWithToc = document.querySelector(".article-reading-layout.has-toc");
    const readingContent = document.querySelector(".article-reading-content");
    if (!button || !footer) return null;
    const rect = element => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    return {
      scrollY: window.scrollY,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      classes: button.className,
      ariaHidden: button.getAttribute("aria-hidden"),
      tabIndex: button.tabIndex,
      button: rect(button),
      footer: rect(footer),
      layoutWithToc: rect(layoutWithToc),
      readingContent: rect(readingContent),
      opacity: getComputedStyle(button).opacity,
      pointerEvents: getComputedStyle(button).pointerEvents,
    };
  });
}

function isVisible(state) {
  return state && Number(state.opacity) > 0.9 && state.classes.includes("opacity-100");
}

async function waitForSettledTransition(page) {
  await page.waitForTimeout(260);
}

async function verifyCase(browser, label, route, width, height, expectToc) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "load", timeout: 45_000 });
    if (!response?.ok()) {
      fail(`${label}: article returned HTTP ${response?.status() ?? "NO_RESPONSE"}`);
      return;
    }

    await waitForSettledTransition(page);
    let state = await snapshot(page);
    if (!state) {
      fail(`${label}: back-to-top button or footer missing`);
      return;
    }

    if (expectToc && !state.layoutWithToc) {
      fail(`${label}: expected article TOC layout is missing`);
    }
    if (!expectToc && state.layoutWithToc) {
      fail(`${label}: no-TOC regression route unexpectedly has a TOC layout`);
    }
    if (!state.readingContent) {
      fail(`${label}: article reading content anchor is missing`);
    }

    if (isVisible(state) || state.ariaHidden !== "true" || state.tabIndex !== -1 || state.pointerEvents !== "none") {
      fail(`${label}: button must be non-interactive and hidden at page top`);
    }
    if (Math.abs(state.button.width - 44) > 1 || Math.abs(state.button.height - 44) > 1) {
      fail(`${label}: button target must remain 44x44px, got ${state.button.width.toFixed(1)}x${state.button.height.toFixed(1)}`);
    }

    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
    await waitForSettledTransition(page);
    state = await snapshot(page);
    if (isVisible(state)) {
      fail(`${label}: button appears before the intended two-viewport threshold`);
    }

    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2.2));
    await waitForSettledTransition(page);
    state = await snapshot(page);
    if (!isVisible(state) || state.ariaHidden !== "false" || state.tabIndex !== 0 || state.pointerEvents === "none") {
      fail(`${label}: button is not visible and keyboard-accessible after two viewports`);
    }

    const inlineGap = state.viewportWidth - state.button.right;
    if (width < 768) {
      if (Math.abs(inlineGap - 20) > 2) {
        fail(`${label}: mobile inline-end gap should stay near 20px, got ${inlineGap.toFixed(1)}px`);
      }
    } else if (width < 1280) {
      if (Math.abs(inlineGap - 24) > 2) {
        fail(`${label}: pre-breakpoint inline-end gap should stay near 24px, got ${inlineGap.toFixed(1)}px`);
      }
    } else {
      const anchor = state.layoutWithToc || state.readingContent;
      if (!anchor) {
        fail(`${label}: desktop reading anchor is missing`);
      } else {
        const availableGutter = state.viewportWidth - anchor.right;
        if (availableGutter >= state.button.width + 44) {
          const gapFromAnchor = state.button.left - anchor.right;
          if (gapFromAnchor < 12 || gapFromAnchor > 28) {
            fail(`${label}: desktop button should sit just outside its reading anchor, got ${gapFromAnchor.toFixed(1)}px gap`);
          }
        }
      }
      if (inlineGap < 23) {
        fail(`${label}: desktop button is too close to viewport edge (${inlineGap.toFixed(1)}px)`);
      }
      if (!expectToc && state.readingContent) {
        const viewportFallbackLeft = state.viewportWidth - 24 - state.button.width;
        if (state.button.left >= viewportFallbackLeft - 2) {
          fail(`${label}: no-TOC article still uses the viewport-edge fallback instead of the reading-content gutter`);
        }
      }
    }

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await waitForSettledTransition(page);
    state = await snapshot(page);
    if (!isVisible(state)) {
      fail(`${label}: button unexpectedly hidden near footer`);
    } else if (state.footer.top < state.viewportHeight && state.button.bottom > state.footer.top - 12) {
      fail(`${label}: button overlaps footer; buttonBottom=${state.button.bottom.toFixed(1)}, footerTop=${state.footer.top.toFixed(1)}`);
    }

    await page.locator("#scroll-to-top").click();
    await page.waitForFunction(() => window.scrollY <= 10, null, { timeout: 1500 }).catch(() => {});
    state = await snapshot(page);
    if (state.scrollY > 10) {
      fail(`${label}: clicking back-to-top did not return near page top (scrollY=${state.scrollY.toFixed(1)})`);
    }

    console.log(`${label}: PASS`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const [label, route, width, height, expectToc] of CASES) {
    await verifyCase(browser, label, route, width, height, expectToc);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`Back-to-top behavior verification: FAIL (${failures.length} issue(s))`);
  process.exit(1);
}

console.log("Back-to-top behavior verification: PASS (threshold + TOC/no-TOC reading-anchor placement + footer avoidance + click return)");
