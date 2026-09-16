#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const OUTPUT_DIR = path.resolve(
  process.env.WEEKLY_QA_OUTPUT || process.env.LIVE_QA_OUTPUT || "entry-page-layout-qa",
);
const failures = [];
const report = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  samples: {},
};

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

function near(a, b, tolerance = 4) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function luminance([r, g, b]) {
  const values = [r, g, b].map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrastRatio(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function parseRgb(value) {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1]
    .split(/[ ,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
}

async function open(page, route, label) {
  const response = await page.goto(`${BASE_URL}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
  if (!response?.ok()) fail(`${label}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
}

async function collectEntryState(page, kind) {
  return page.evaluate(kindName => {
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

    const main = document.querySelector("#main-content");
    const heading = main?.querySelector(":scope > header h1, :scope > article > header h1");
    const lead = main?.querySelector(".huikai-page-lead");
    const leadParent = lead?.parentElement || null;
    const state = {
      main: rect(main),
      heading: rect(heading),
      lead: rect(lead),
      leadParent: rect(leadParent),
      leadText: lead?.textContent?.trim() || "",
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };

    if (kindName === "projects") {
      const grid = [...(main?.querySelectorAll("section.w-full.grid") || [])].find(node =>
        node.querySelector(".article-link--card"),
      );
      const cards = [...(grid?.querySelectorAll(":scope > .article-link--card") || [])];
      state.grid = rect(grid);
      state.cards = cards.map(rect);
      state.gridColumns = grid ? getComputedStyle(grid).gridTemplateColumns : "";
      state.proseParagraphs = [...(leadParent?.children || [])]
        .filter(node => ["P", "UL", "OL", "BLOCKQUOTE"].includes(node.tagName))
        .map(rect);
    }

    if (kindName === "explore") {
      const firstGrid = main?.querySelector(".explore-grid");
      state.grid = rect(firstGrid);
      state.gridColumns = firstGrid ? getComputedStyle(firstGrid).gridTemplateColumns : "";
    }

    if (kindName === "about") {
      const section = main?.querySelector(":scope > article > section.prose");
      const children = [...(section?.children || [])];
      const firstHrIndex = children.findIndex(node => node.tagName === "HR");
      const longform = firstHrIndex >= 0 ? children.slice(firstHrIndex + 1) : [];
      state.longform = longform
        .filter(node => !["SCRIPT", "STYLE"].includes(node.tagName))
        .map(node => ({ tag: node.tagName, rect: rect(node) }));
      const authorLinks = main?.querySelector(".about-author-links");
      const authorLinkContainer = authorLinks?.firstElementChild || null;
      const bodyStyle = getComputedStyle(document.body);
      const linkStyle = authorLinkContainer ? getComputedStyle(authorLinkContainer) : null;
      state.authorLinks = {
        count: authorLinks?.querySelectorAll("a").length || 0,
        color: linkStyle?.color || "",
        background: bodyStyle.backgroundColor || "",
      };
    }

    return state;
  }, kind);
}

function assertSharedDesktopGeometry(localeLabel, states) {
  const entries = Object.entries(states);
  for (const [kind, state] of entries) {
    if (!state.main || !state.heading || !state.lead) {
      fail(`${localeLabel}/${kind}: missing main, heading or page lead geometry`);
      continue;
    }
    if (state.overflow > 1) {
      fail(`${localeLabel}/${kind}: horizontal overflow ${state.overflow.toFixed(1)}px`);
    }
    if (state.lead.width > 706) {
      fail(`${localeLabel}/${kind}: lead exceeds 44rem reading measure (${state.lead.width.toFixed(1)}px)`);
    }
  }

  const valid = entries.filter(([, state]) => state.heading && state.lead);
  if (valid.length === entries.length) {
    const headingLeft = valid[0][1].heading.left;
    const leadLeft = valid[0][1].lead.left;
    for (const [kind, state] of valid.slice(1)) {
      if (!near(state.heading.left, headingLeft, 2)) {
        fail(`${localeLabel}/${kind}: H1 scan axis drifted (${state.heading.left.toFixed(1)} vs ${headingLeft.toFixed(1)}px)`);
      }
      if (!near(state.lead.left, leadLeft, 2)) {
        fail(`${localeLabel}/${kind}: lead scan axis drifted (${state.lead.left.toFixed(1)} vs ${leadLeft.toFixed(1)}px)`);
      }
      if (!near(state.lead.width, valid[0][1].lead.width, 4)) {
        fail(`${localeLabel}/${kind}: lead measure drifted (${state.lead.width.toFixed(1)} vs ${valid[0][1].lead.width.toFixed(1)}px)`);
      }
    }
  }
}

function assertProjects(localeLabel, state, desktop) {
  if (!state.grid || !state.leadParent) {
    return fail(`${localeLabel}/projects: missing list content wrapper or project grid`);
  }
  if (desktop) {
    if (state.leadParent.width < state.lead.width + 80) {
      fail(`${localeLabel}/projects: Blowfish max-w-prose still narrows the list content wrapper (${state.leadParent.width.toFixed(1)}px)`);
    }
    if (!near(state.grid.width, state.main.width, 4)) {
      fail(`${localeLabel}/projects: card grid does not use the page shell (${state.grid.width.toFixed(1)} vs ${state.main.width.toFixed(1)}px)`);
    }
    if (state.cards.length !== 2) {
      fail(`${localeLabel}/projects: expected two long-term project cards, found ${state.cards.length}`);
    } else if (!(state.grid.width > state.cards[0].width * 2.7)) {
      fail(`${localeLabel}/projects: two cards appear stretched instead of retaining the three-column grid contract`);
    }
    for (const paragraph of state.proseParagraphs || []) {
      if (paragraph?.width > 706) {
        fail(`${localeLabel}/projects: prose after lead exceeds reading measure (${paragraph.width.toFixed(1)}px)`);
      }
    }
  } else if (state.cards.length && state.grid.width - state.cards[0].width > 4) {
    fail(`${localeLabel}/projects: mobile project card does not reclaim the full grid width`);
  }
}

function assertExplore(localeLabel, state, desktop) {
  if (!state.grid) return fail(`${localeLabel}/explore: discovery grid is missing`);
  if (/Notion/i.test(state.leadText)) {
    fail(`${localeLabel}/explore: reader-facing lead still exposes Notion implementation detail`);
  }
  if (desktop && !near(state.grid.width, state.main.width, 4)) {
    fail(`${localeLabel}/explore: discovery grid does not use the page shell (${state.grid.width.toFixed(1)} vs ${state.main.width.toFixed(1)}px)`);
  }
}

function assertAbout(localeLabel, state) {
  const longformRects = (state.longform || []).map(item => item.rect).filter(Boolean);
  if (!longformRects.length) {
    fail(`${localeLabel}/about: long-form section after the first divider is missing`);
  }
  for (const item of state.longform || []) {
    if (item.rect && item.rect.width > 706) {
      fail(`${localeLabel}/about: ${item.tag} exceeds 44rem long-form measure (${item.rect.width.toFixed(1)}px)`);
    }
  }
  if (!state.authorLinks?.count) {
    fail(`${localeLabel}/about: author links are missing`);
    return;
  }
  const foreground = parseRgb(state.authorLinks.color);
  const background = parseRgb(state.authorLinks.background);
  if (!foreground || !background) {
    fail(`${localeLabel}/about: could not resolve author-link contrast colors`);
    return;
  }
  const ratio = contrastRatio(foreground, background);
  state.authorLinks.contrastRatio = ratio;
  if (ratio < 3) {
    fail(`${localeLabel}/about: author-link icon contrast is too low (${ratio.toFixed(2)}:1)`);
  }
}

async function verifyLocale(browser, localePrefix, localeLabel) {
  const desktop = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  try {
    const states = {};
    for (const kind of ["projects", "explore", "about"]) {
      const page = await desktop.newPage();
      const route = `${localePrefix}/${kind}/`.replace(/\/+/g, "/");
      await open(page, route, `${localeLabel}/${kind}/desktop`);
      states[kind] = await collectEntryState(page, kind);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${localeLabel}-${kind}-desktop.png`),
        fullPage: true,
      });
      await page.close();
    }
    report.samples[`${localeLabel}-desktop`] = states;
    assertSharedDesktopGeometry(localeLabel, states);
    assertProjects(localeLabel, states.projects, true);
    assertExplore(localeLabel, states.explore, true);
    assertAbout(localeLabel, states.about);
  } finally {
    await desktop.close();
  }

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  try {
    const states = {};
    for (const kind of ["projects", "explore", "about"]) {
      const page = await mobile.newPage();
      const route = `${localePrefix}/${kind}/`.replace(/\/+/g, "/");
      await open(page, route, `${localeLabel}/${kind}/mobile`);
      states[kind] = await collectEntryState(page, kind);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${localeLabel}-${kind}-mobile.png`),
        fullPage: true,
      });
      await page.close();
    }
    report.samples[`${localeLabel}-mobile`] = states;
    for (const [kind, state] of Object.entries(states)) {
      if (state.overflow > 1) fail(`${localeLabel}/${kind}/mobile: horizontal overflow ${state.overflow.toFixed(1)}px`);
      if (state.lead && state.main && state.lead.width > state.main.width + 1) {
        fail(`${localeLabel}/${kind}/mobile: lead escapes the page shell`);
      }
    }
    assertProjects(localeLabel, states.projects, false);
    assertExplore(localeLabel, states.explore, false);
    assertAbout(localeLabel, states.about);
  } finally {
    await mobile.close();
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyLocale(browser, "", "zh-TW");
    await verifyLocale(browser, "/zh-cn", "zh-CN");
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(
    path.join(OUTPUT_DIR, "entry-page-layout.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (failures.length) {
    console.error(`Entry page layout verification: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }

  console.log("Entry page layout verification: PASS (shared shell + bounded reading measure + project grid + Explore copy + About contrast + mobile overflow)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
