#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const OUTPUT_DIR = path.resolve(process.env.ENTRY_MEDIA_QA_OUTPUT || "entry-media-readiness-qa");
const ROUTES = [
  ["zh-TW-posts", "/posts/"],
  ["zh-TW-projects", "/projects/"],
  ["zh-TW-explore", "/explore/"],
  ["zh-TW-about", "/about/"],
  ["zh-CN-posts", "/zh-cn/posts/"],
  ["zh-CN-projects", "/zh-cn/projects/"],
  ["zh-CN-explore", "/zh-cn/explore/"],
  ["zh-CN-about", "/zh-cn/about/"],
];
const VIEWPORTS = [
  ["desktop", { width: 1200, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
];
const failures = [];
const report = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  samples: [],
};

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function open(page, route, label) {
  const response = await page.goto(`${BASE_URL}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
  if (!response?.ok()) fail(`${label}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
}

async function sweepViewport(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(120);

  for (let index = 0; index < 80; index += 1) {
    const state = await page.evaluate(() => {
      const root = document.documentElement;
      const maxY = Math.max(0, root.scrollHeight - window.innerHeight);
      const step = Math.max(240, Math.floor(window.innerHeight * 0.75));
      const nextY = Math.min(maxY, window.scrollY + step);
      window.scrollTo(0, nextY);
      return { maxY, nextY };
    });

    await page.waitForTimeout(120);
    if (state.nextY >= state.maxY) break;
  }

  await page.waitForTimeout(250);
}

async function settleImages(page) {
  return page.evaluate(async () => {
    const timeout = ms => new Promise(resolve => setTimeout(resolve, ms));
    const candidates = [...document.images].filter(img => {
      const rect = img.getBoundingClientRect();
      const style = getComputedStyle(img);
      const source = img.currentSrc || img.src || "";
      return Boolean(source)
        && rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden";
    });

    const waitForImage = img => new Promise(resolve => {
      if (img.complete) {
        resolve();
        return;
      }

      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        resolve();
      };

      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, 5000);
    });

    await Promise.all(candidates.map(waitForImage));
    await Promise.all(candidates.map(async img => {
      if (img.complete && img.naturalWidth > 0 && typeof img.decode === "function") {
        await Promise.race([img.decode().catch(() => {}), timeout(2000)]);
      }
    }));

    return candidates.map(img => {
      const state = !img.complete ? "pending" : img.naturalWidth > 0 ? "loaded" : "broken";
      return {
        state,
        loading: img.loading || "auto",
        alt: img.alt || "",
        source: img.currentSrc || img.src || "",
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
    });
  });
}

async function capture(browser, routeLabel, route, viewportLabel, viewport) {
  const context = await browser.newContext({
    viewport,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const label = `${routeLabel}/${viewportLabel}`;

  try {
    await open(page, route, label);
    await sweepViewport(page);
    const images = await settleImages(page);
    const pending = images.filter(item => item.state === "pending");
    const broken = images.filter(item => item.state === "broken");

    if (pending.length) {
      fail(`${label}: ${pending.length} render-relevant image(s) still pending after viewport sweep and settle window`);
    }
    if (broken.length) {
      fail(`${label}: ${broken.length} render-relevant image(s) failed to load`);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(160);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const screenshotPath = path.join(OUTPUT_DIR, `${routeLabel}-${viewportLabel}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    report.samples.push({
      route,
      label: routeLabel,
      viewport: viewportLabel,
      imageCount: images.length,
      loadedCount: images.filter(item => item.state === "loaded").length,
      pendingCount: pending.length,
      brokenCount: broken.length,
      images,
      screenshot: path.relative(OUTPUT_DIR, screenshotPath),
    });
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    for (const [routeLabel, route] of ROUTES) {
      for (const [viewportLabel, viewport] of VIEWPORTS) {
        await capture(browser, routeLabel, route, viewportLabel, viewport);
      }
    }
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(
    path.join(OUTPUT_DIR, "entry-media-readiness.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (failures.length) {
    console.error(`Entry media readiness verification: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }

  console.log("Entry media readiness verification: PASS (viewport sweep + load/decode settle + loaded/pending/broken classification + readiness-safe screenshots)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
