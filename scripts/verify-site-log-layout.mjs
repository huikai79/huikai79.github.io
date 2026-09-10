#!/usr/bin/env node
import process from "node:process";
import { chromium, firefox, webkit } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const ROUTES = [
  ["zh-TW", "/site-log/", "網站紀錄", "待條件成熟再評估"],
  ["zh-CN", "/zh-cn/site-log/", "网站记录", "待条件成熟再评估"],
];
const BROWSERS = { Chromium: chromium, Firefox: firefox, WebKit: webkit };
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function inspect(browserType, browserName, viewportName, width, height) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();

  try {
    for (const [language, route, title, roadmapHeading] of ROUTES) {
      const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 45_000 });
      if (!response?.ok()) {
        fail(`${browserName}/${viewportName}/${language}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
        continue;
      }

      const state = await page.evaluate(({ title, roadmapHeading }) => {
        const root = document.documentElement;
        const pageEl = document.querySelector(".site-log-page");
        const h1 = pageEl?.querySelector(".site-log-header h1");
        const content = pageEl?.querySelector(".site-log-content");
        const h2 = content?.querySelector("h2");
        const h3 = content?.querySelector("h3");
        const footerMenu = document.querySelector("#site-footer .site-footer-menu");
        const footerLink = footerMenu?.querySelector("a");
        if (!pageEl || !h1 || !content || !h2 || !h3 || !footerMenu || !footerLink) return null;

        const h1Style = getComputedStyle(h1);
        const contentStyle = getComputedStyle(content);
        const h2Style = getComputedStyle(h2);
        const h3Style = getComputedStyle(h3);
        const footerStyle = getComputedStyle(footerMenu);
        const pageRect = pageEl.getBoundingClientRect();
        const roadmapFound = [...content.querySelectorAll("h2")].some(el => (el.textContent || "").includes(roadmapHeading));

        return {
          lang: root.lang,
          h1Text: (h1.textContent || "").trim(),
          h1Count: document.querySelectorAll("h1").length,
          h1Size: Number.parseFloat(h1Style.fontSize || "0"),
          h1Weight: Number.parseInt(h1Style.fontWeight || "0", 10),
          contentSize: Number.parseFloat(contentStyle.fontSize || "0"),
          contentLineHeight: Number.parseFloat(contentStyle.lineHeight || "0"),
          h2Size: Number.parseFloat(h2Style.fontSize || "0"),
          h3Size: Number.parseFloat(h3Style.fontSize || "0"),
          footerSize: Number.parseFloat(footerStyle.fontSize || "0"),
          footerWeight: Number.parseInt(footerStyle.fontWeight || "0", 10),
          footerText: (footerLink.textContent || "").trim(),
          pageWidth: pageRect.width,
          viewportWidth: root.clientWidth,
          overflow: root.scrollWidth - root.clientWidth,
          roadmapFound,
          expectedTitle: title,
        };
      }, { title, roadmapHeading });

      if (!state) {
        fail(`${browserName}/${viewportName}/${language}: site-log layout contract missing`);
        continue;
      }

      if (state.h1Count !== 1) fail(`${browserName}/${viewportName}/${language}: expected one H1, got ${state.h1Count}`);
      if (state.h1Text !== state.expectedTitle) fail(`${browserName}/${viewportName}/${language}: H1 mismatch (${state.h1Text})`);
      if (state.h1Weight < 600 || state.h1Weight > 750) fail(`${browserName}/${viewportName}/${language}: H1 weight ${state.h1Weight} outside compact hierarchy`);
      if (width >= 640 && (state.h1Size < 27 || state.h1Size > 29)) fail(`${browserName}/${viewportName}/${language}: desktop H1 ${state.h1Size}px, expected ~28px`);
      if (width < 640 && (state.h1Size < 24 || state.h1Size > 26)) fail(`${browserName}/${viewportName}/${language}: mobile H1 ${state.h1Size}px, expected ~24.8px`);
      if (width >= 640 && (state.contentSize < 14.5 || state.contentSize > 15.5)) fail(`${browserName}/${viewportName}/${language}: desktop log body ${state.contentSize}px, expected ~15px`);
      if (width < 640 && (state.contentSize < 14 || state.contentSize > 15)) fail(`${browserName}/${viewportName}/${language}: mobile log body ${state.contentSize}px, expected ~14.4px`);
      if (state.contentLineHeight < state.contentSize * 1.65) fail(`${browserName}/${viewportName}/${language}: log body line-height too tight (${state.contentLineHeight}px)`);
      if (state.h2Size >= 21) fail(`${browserName}/${viewportName}/${language}: date/section H2 remains too large (${state.h2Size}px)`);
      if (state.h3Size > 16) fail(`${browserName}/${viewportName}/${language}: subsection H3 remains too large (${state.h3Size}px)`);
      if (Math.abs(state.footerSize - 13) > 0.6) fail(`${browserName}/${viewportName}/${language}: footer site-log link ${state.footerSize}px, expected ~13px`);
      if (state.footerWeight > 500) fail(`${browserName}/${viewportName}/${language}: footer site-log link weight too strong (${state.footerWeight})`);
      if (!state.roadmapFound) fail(`${browserName}/${viewportName}/${language}: conditional roadmap heading missing`);
      if (state.pageWidth > state.viewportWidth + 1 || state.overflow > 1) fail(`${browserName}/${viewportName}/${language}: horizontal overflow (${state.overflow}px)`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  for (const [browserName, browserType] of Object.entries(BROWSERS)) {
    await inspect(browserType, browserName, "desktop", 1440, 1000);
    await inspect(browserType, browserName, "mobile", 390, 844);
  }

  if (failures.length) {
    console.error(`Site-log layout verification: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }

  console.log("Site-log layout verification: PASS (compact title/body hierarchy + 13px footer entry + roadmap preservation + zh-TW/zh-CN + responsive safety)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
