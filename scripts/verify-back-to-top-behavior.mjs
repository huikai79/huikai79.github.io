#!/usr/bin/env node
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const ROUTE = "/posts/first-hackathon/";
const VIEWPORTS = [
  ["mobile", 390, 844],
  ["pre-breakpoint", 1279, 900],
  ["desktop", 1440, 1000],
  ["wide-desktop", 1600, 1000],
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
    const layout = document.querySelector(".article-reading-layout.has-toc");
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
      layout: rect(layout),
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

async function verifyViewport(browser, label, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "load", timeout: 45_000 });
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
    } else if (state.layout) {
      const availableGutter = state.viewportWidth - state.layout.right;
      if (availableGutter >= state.button.width + 44) {
        const gapFromLayout = state.button.left - state.layout.right;
        if (gapFromLayout < 12 || gapFromLayout > 28) {
          fail(`${label}: desktop button should sit just outside reading layout, got ${gapFromLayout.toFixed(1)}px gap`);
        }
      }
      if (inlineGap < 23) {
        fail(`${label}: desktop button is too close to viewport edge (${inlineGap.toFixed(1)}px)`);
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
  for (const [label, width, height] of VIEWPORTS) {
    await verifyViewport(browser, label, width, height);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`Back-to-top behavior verification: FAIL (${failures.length} issue(s))`);
  process.exit(1);
}

console.log("Back-to-top behavior verification: PASS (threshold + responsive placement + reading gutter + footer avoidance + click return)");
