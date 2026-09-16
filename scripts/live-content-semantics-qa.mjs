#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const EXPECTED_SHA = (process.env.EXPECTED_SOURCE_SHA || "").trim();
const QA_ROOT = path.resolve(process.env.LIVE_QA_OUTPUT || "live-reader-qa");
const OUT_DIR = path.join(QA_ROOT, "content-semantics");
const PENANG_ROUTE = "/posts/menulis-dalam-masyarakat-rencam/";
const WRITING_ROUTE = "/posts/writing-advice/";
const WRITING_VIDEO_URL = "https://www.youtube.com/watch?v=-6HOdHEeosc";
const WRITING_VIDEO_ID = "-6HOdHEeosc";
const failures = [];
const report = {
  baseUrl: BASE_URL,
  expectedSourceSha: EXPECTED_SHA || null,
  startedAt: new Date().toISOString(),
  penang: {},
  writingAdvice: {}
};

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

async function verifyLineage() {
  if (!EXPECTED_SHA) return;
  const response = await fetch(`${BASE_URL}/source-commit.txt`, { redirect: "follow" });
  if (!response.ok) return fail(`source lineage: HTTP ${response.status}`);
  const actual = (await response.text()).trim();
  report.actualSourceSha = actual;
  if (actual !== EXPECTED_SHA) fail(`source lineage mismatch: expected=${EXPECTED_SHA}, actual=${actual}`);
}

async function navigate(page, route, label) {
  const response = await page.goto(`${BASE_URL}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });
  await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
  if (!response?.ok()) fail(`${label}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);
  if (new URL(page.url()).pathname !== route) fail(`${label}: route changed to ${new URL(page.url()).pathname}`);
  return response;
}

async function verifyPenang(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await navigate(page, PENANG_ROUTE, "penang");
    const state = await page.evaluate(() => {
      const article = document.querySelector(".article-main") || document.querySelector("main");
      const paragraphs = [...(article?.querySelectorAll("p") || [])]
        .map(node => (node.textContent || "").trim())
        .filter(Boolean);
      const h2Texts = [...(article?.querySelectorAll("h2") || [])]
        .map(node => (node.textContent || "").trim())
        .filter(Boolean);
      const tocTexts = [...document.querySelectorAll(".article-toc a")]
        .map(node => (node.textContent || "").trim())
        .filter(Boolean);
      return {
        paragraphCount: paragraphs.length,
        hrCount: article?.querySelectorAll("hr").length || 0,
        h2Texts,
        maxH2Length: Math.max(0, ...h2Texts.map(value => value.length)),
        tocTexts,
        maxTocTextLength: Math.max(0, ...tocTexts.map(value => value.length))
      };
    });

    if (state.paragraphCount < 8) fail(`penang: expected structured paragraphs, got ${state.paragraphCount}`);
    if (state.hrCount < 1) fail("penang: author-bio divider is missing");
    if (state.maxH2Length > 300) fail(`penang: suspicious giant H2 remains (${state.maxH2Length} chars)`);
    if (state.maxTocTextLength > 180) fail(`penang: suspicious prose-sized TOC entry remains (${state.maxTocTextLength} chars)`);

    const screenshot = path.join(OUT_DIR, "penang-article.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    report.penang = { responseStatus: response?.status() ?? null, state, screenshot: path.relative(QA_ROOT, screenshot) };
  } finally {
    await context.close();
  }
}

async function verifyWritingAdvice(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const response = await navigate(page, WRITING_ROUTE, "writing-advice");
    const state = await page.evaluate(({ videoUrl, videoId }) => {
      const article = document.querySelector(".article-main") || document.querySelector("main");
      const links = [...(article?.querySelectorAll("a") || [])]
        .filter(link => link.href === videoUrl)
        .map(link => ({ href: link.href, text: (link.textContent || "").trim() }));
      const matchingFrames = [...document.querySelectorAll("iframe")]
        .map(frame => frame.getAttribute("src") || "")
        .filter(src => src.includes(videoId));
      return { links, matchingFrames };
    }, { videoUrl: WRITING_VIDEO_URL, videoId: WRITING_VIDEO_ID });

    if (!state.links.length) fail(`writing-advice: ordinary YouTube hyperlink missing: ${WRITING_VIDEO_URL}`);
    if (!state.links.some(link => /Brandon Sanderson/i.test(link.text))) {
      fail("writing-advice: expected Brandon Sanderson link text is missing");
    }
    if (state.matchingFrames.length) {
      fail(`writing-advice: ordinary link was rendered as YouTube iframe: ${state.matchingFrames.join(", ")}`);
    }

    const screenshot = path.join(OUT_DIR, "writing-advice.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    report.writingAdvice = { responseStatus: response?.status() ?? null, state, screenshot: path.relative(QA_ROOT, screenshot) };
  } finally {
    await context.close();
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await verifyLineage();
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyPenang(browser);
    await verifyWritingAdvice(browser);
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) {
    console.error(`Content semantics live QA: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }
  console.log("Content semantics live QA: PASS (Setext/TOC + ordinary YouTube-link regressions)");
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
