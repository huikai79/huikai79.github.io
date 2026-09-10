#!/usr/bin/env node
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const CASES = [
  {
    label: "zh-TW",
    route: "/",
    homePath: "/",
    homeLabel: "首頁",
    expectedMenu: ["文章", "專案", "探索", "關於"],
  },
  {
    label: "zh-CN",
    route: "/zh-cn/",
    homePath: "/zh-cn/",
    homeLabel: "首页",
    expectedMenu: ["文章", "项目", "探索", "关于"],
  },
];

const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

function normalizePath(href) {
  try {
    return new URL(href, BASE_URL).pathname;
  } catch {
    return href;
  }
}

async function verifyBrand(page, spec, surface) {
  const brand = page.locator('header a[href]').filter({ hasText: "HUIKAI" }).first();
  if ((await brand.count()) !== 1 || !(await brand.isVisible())) {
    fail(`${spec.label} ${surface}: visible HUIKAI brand-home link is missing`);
    return;
  }

  const href = await brand.getAttribute("href");
  if (normalizePath(href || "") !== spec.homePath) {
    fail(`${spec.label} ${surface}: HUIKAI brand should link to ${spec.homePath}, got ${href}`);
  }
  const text = (await brand.innerText()).trim();
  if (text !== "HUIKAI") {
    fail(`${spec.label} ${surface}: brand label should remain exactly HUIKAI, got ${JSON.stringify(text)}`);
  }
}

async function verifyDesktop(browser, spec) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${BASE_URL}${spec.route}`, { waitUntil: "load", timeout: 45_000 });
    if (!response?.ok()) {
      fail(`${spec.label} desktop: homepage returned HTTP ${response?.status() ?? "NO_RESPONSE"}`);
      return;
    }

    await verifyBrand(page, spec, "desktop");

    const desktopNav = page.locator("header .hidden.md\\:flex nav").first();
    if ((await desktopNav.count()) !== 1 || !(await desktopNav.isVisible())) {
      fail(`${spec.label} desktop: desktop main navigation is missing`);
      return;
    }
    const navText = (await desktopNav.innerText()).replace(/\s+/g, " ").trim();
    if (navText.includes(spec.homeLabel)) {
      fail(`${spec.label} desktop: duplicate explicit ${spec.homeLabel} item is still visible beside HUIKAI`);
    }
    for (const label of spec.expectedMenu) {
      if (!navText.includes(label)) {
        fail(`${spec.label} desktop: expected navigation item ${label} is missing`);
      }
    }
  } finally {
    await context.close();
  }
}

async function verifyMobile(browser, spec) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${BASE_URL}${spec.route}`, { waitUntil: "load", timeout: 45_000 });
    if (!response?.ok()) {
      fail(`${spec.label} mobile: homepage returned HTTP ${response?.status() ?? "NO_RESPONSE"}`);
      return;
    }

    await verifyBrand(page, spec, "mobile");

    // Blowfish's responsive mobile controls are rendered adjacent to the
    // desktop wrapper rather than inside the semantic <header> element in all
    // layout variants. Target the stable control contract globally.
    const toggleInput = page.locator("#mobile-menu-toggle");
    const toggle = page.locator('label[for="mobile-menu-toggle"]').first();
    if ((await toggleInput.count()) !== 1 || (await toggle.count()) < 1 || !(await toggle.isVisible())) {
      fail(`${spec.label} mobile: visible menu toggle is missing`);
      return;
    }

    await toggle.click();
    const dialog = page.locator("#mobile-menu-dialog");
    await dialog.waitFor({ state: "visible", timeout: 3_000 });
    const navText = (await dialog.innerText()).replace(/\s+/g, " ").trim();
    if (navText.includes(spec.homeLabel)) {
      fail(`${spec.label} mobile: duplicate explicit ${spec.homeLabel} item remains even though HUIKAI is persistently visible`);
    }
    for (const label of spec.expectedMenu) {
      if (!navText.includes(label)) {
        fail(`${spec.label} mobile: expected navigation item ${label} is missing`);
      }
    }
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const spec of CASES) {
    await verifyDesktop(browser, spec);
    await verifyMobile(browser, spec);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`Header home navigation verification: FAIL (${failures.length} issue(s))`);
  process.exit(1);
}

console.log("Header home navigation verification: PASS (persistent HUIKAI home link + no duplicate Home item + zh-TW/zh-CN desktop/mobile menus)");
