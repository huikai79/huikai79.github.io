#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "https://huikai.com.kg").replace(/\/$/, "");
const EXPECTED_SHA = (process.env.EXPECTED_SOURCE_SHA || "").trim();
const QA_ROOT = path.resolve(process.env.LIVE_QA_OUTPUT || "live-reader-qa");
const PLAN_PATH = path.resolve(process.env.LIVE_CHANGED_ROUTE_PLAN || path.join(QA_ROOT, "changed-routes.json"));
const OUT_DIR = path.join(QA_ROOT, "changed-routes");
const VIEWPORTS = [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844]
];
const failures = [];
const report = {
  baseUrl: BASE_URL,
  expectedSourceSha: EXPECTED_SHA || null,
  planPath: PLAN_PATH,
  startedAt: new Date().toISOString(),
  present: [],
  absent: []
};

function fail(message) {
  failures.push(message);
  console.error(`::error::${message}`);
}

function safeName(route = "") {
  return route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-") || "root";
}

async function verifyLineage() {
  if (!EXPECTED_SHA) return;
  const response = await fetch(`${BASE_URL}/source-commit.txt`, { redirect: "follow" });
  if (!response.ok) return fail(`source lineage: HTTP ${response.status}`);
  const actual = (await response.text()).trim();
  report.actualSourceSha = actual;
  if (actual !== EXPECTED_SHA) fail(`source lineage mismatch: expected=${EXPECTED_SHA}, actual=${actual}`);
}

async function inspectPresentRoute(browser, entry, viewportName, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const failedRequests = [];
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "failed"}`);
  });
  try {
    const response = await page.goto(`${BASE_URL}${entry.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => {});
    if (!response?.ok()) fail(`${entry.route} ${viewportName}: HTTP ${response?.status() ?? "NO_RESPONSE"}`);

    const state = await page.evaluate(() => {
      const root = document.documentElement;
      const main = document.querySelector("main");
      const brokenImages = [...document.images]
        .filter(image => image.complete && image.naturalWidth === 0)
        .map(image => image.currentSrc || image.src || image.alt || "unknown");
      return {
        path: location.pathname,
        title: document.title,
        lang: root.lang || "",
        h1Count: document.querySelectorAll("main h1").length,
        bodyTextLength: (main?.innerText || "").trim().length,
        overflowX: Math.max(0, root.scrollWidth - root.clientWidth),
        brokenImages
      };
    });

    if (state.path !== entry.route) fail(`${entry.route} ${viewportName}: route changed to ${state.path}`);
    if (state.h1Count !== 1) fail(`${entry.route} ${viewportName}: expected one main H1, got ${state.h1Count}`);
    if (state.bodyTextLength < 20) fail(`${entry.route} ${viewportName}: main content appears empty`);
    if (state.overflowX > 1) fail(`${entry.route} ${viewportName}: horizontal overflow ${state.overflowX}px`);
    if (state.brokenImages.length) fail(`${entry.route} ${viewportName}: broken images: ${state.brokenImages.join(", ")}`);

    const screenshot = path.join(OUT_DIR, `${safeName(entry.route)}-${viewportName}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    report.present.push({
      ...entry,
      viewport: viewportName,
      responseStatus: response?.status() ?? null,
      state,
      failedRequests,
      screenshot: path.relative(QA_ROOT, screenshot)
    });
  } finally {
    await context.close();
  }
}

async function inspectAbsentRoute(entry) {
  try {
    const response = await fetch(`${BASE_URL}${entry.route}`, { redirect: "manual" });
    const location = response.headers.get("location") || "";
    report.absent.push({ ...entry, status: response.status, location });
    if (response.status >= 200 && response.status < 300) {
      fail(`${entry.route}: deleted route still returns HTTP ${response.status}`);
    }
  } catch (error) {
    report.absent.push({ ...entry, error: String(error?.message || error) });
    fail(`${entry.route}: unable to verify deleted route (${error?.message || error})`);
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const plan = JSON.parse(await fs.readFile(PLAN_PATH, "utf8"));
  report.plan = {
    version: plan.version ?? null,
    base: plan.base ?? null,
    head: plan.head ?? null,
    presentCount: plan.present?.length ?? 0,
    absentCount: plan.absent?.length ?? 0
  };

  await verifyLineage();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const entry of plan.present ?? []) {
      for (const [viewportName, width, height] of VIEWPORTS) {
        await inspectPresentRoute(browser, entry, viewportName, width, height);
      }
    }
  } finally {
    await browser.close();
  }

  for (const entry of plan.absent ?? []) await inspectAbsentRoute(entry);

  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  await fs.writeFile(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) {
    console.error(`Changed-route live QA: FAIL (${failures.length} issue(s))`);
    process.exit(1);
  }
  console.log(
    `Changed-route live QA: PASS ` +
    `(present=${plan.present?.length ?? 0} routes x ${VIEWPORTS.length} viewports, absent=${plan.absent?.length ?? 0})`
  );
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
