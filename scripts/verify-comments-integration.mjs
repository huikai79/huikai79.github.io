#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const ARTICLE_PATH = process.env.COMMENTS_QA_ARTICLE || "/posts/first-hackathon/";
const PROVIDER = (process.env.COMMENTS_PROVIDER || "giscus").toLowerCase();
const OUTPUT_DIR = path.resolve(process.env.COMMENTS_QA_OUTPUT || process.env.WEEKLY_QA_OUTPUT || "weekly-reader-a11y-qa");
const DEFAULT_COMMENTS = [
  { id:"11111111-1111-4111-8111-111111111111", parentId:null, displayName:"讀者甲", body:"<img src=x onerror=alert(1)> 必須是純文字", isAuthor:false, createdAt:"2026-09-10T00:00:00.000Z", withdrawn:false },
  { id:"22222222-2222-4222-8222-222222222222", parentId:"11111111-1111-4111-8111-111111111111", displayName:"HUIKAI", body:"作者補充", isAuthor:true, createdAt:"2026-09-10T00:01:00.000Z", withdrawn:false },
];

function assertAligned(geometry) {
  if (!geometry?.comments || !geometry?.reference) throw new Error("comments integration: geometry unavailable");
  if (Math.abs(geometry.comments.left - geometry.reference.left) > 2 || Math.abs(geometry.comments.right - geometry.reference.right) > 2) throw new Error("comments integration: footer alignment drift");
}

async function geometry(page, selector) {
  return page.evaluate(selectorText => {
    const node = document.querySelector(selectorText);
    const comments = node?.closest(".article-footer");
    const reference = [...document.querySelectorAll(".article-footer")].filter(item => item !== comments).at(-1);
    const reading = document.querySelector(".article-reading-content");
    const rect = item => item ? (() => { const box = item.getBoundingClientRect(); return { left:box.left, right:box.right, width:box.width }; })() : null;
    return { comments:rect(comments), reference:rect(reference), reading:rect(reading) };
  }, selector);
}

async function ensureTheme(page, colorScheme, label) {
  const desiredDark=colorScheme === "dark";
  let actualDark=await page.locator("html").evaluate(el=>el.classList.contains("dark"));
  if (actualDark !== desiredDark) {
    const switcher=page.locator("#appearance-switcher:visible, #appearance-switcher-mobile:visible").first();
    if (!(await switcher.count())) throw new Error(`HUIKAI comments ${label}: appearance switcher missing`);
    await switcher.click();
    await page.waitForTimeout(200);
    actualDark=await page.locator("html").evaluate(el=>el.classList.contains("dark"));
  }
  if (actualDark !== desiredDark) throw new Error(`HUIKAI comments ${label}: requested ${colorScheme} but html.dark=${actualDark}`);
  return actualDark;
}

async function verifyGiscus(browser) {
  const context = await browser.newContext({ viewport:{width:1440,height:1000}, reducedMotion:"reduce" });
  const page = await context.newPage();
  try {
    await page.route("https://giscus.app/client.js", route => route.fulfill({ status:200, contentType:"application/javascript", body:`(()=>{const s=document.currentScript,c=s?.parentElement;if(!c)return;const f=document.createElement('iframe');f.className='giscus-frame';f.src='about:blank';c.append(f)})();` }));
    const response = await page.goto(`${BASE_URL}${ARTICLE_PATH}`, { waitUntil:"domcontentloaded", timeout:45_000 });
    if (!response?.ok()) throw new Error(`Giscus QA navigation failed: ${response?.status()}`);
    await page.locator("iframe.giscus-frame").waitFor({ state:"attached", timeout:5000 });
    const result = await page.evaluate(() => {
      const root=document.querySelector('.giscus-comments');
      const script=document.querySelector('script[src="https://giscus.app/client.js"]');
      return { key:root?.dataset.commentKey||"", scripts:document.querySelectorAll('script[src="https://giscus.app/client.js"]').length, frames:document.querySelectorAll('iframe.giscus-frame').length, mapping:script?.dataset.mapping||"", term:script?.dataset.term||"" };
    });
    if (!result.key || result.scripts !== 1 || result.frames !== 1 || result.mapping !== "specific" || result.term !== result.key) throw new Error(`Giscus integration contract failed: ${JSON.stringify(result)}`);
    const measured = await geometry(page, ".giscus-comments"); assertAligned(measured);
    console.log(JSON.stringify({ status:"pass", provider:"giscus", result, measured }, null, 2));
  } finally { await context.close(); }
}

async function installHuikaiMocks(page, { submissions = [], comments = DEFAULT_COMMENTS, failLoad = false } = {}) {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", route => route.fulfill({
    status:200,
    contentType:"application/javascript",
    body:`(()=>{let n=0;const widgets=new Map();window.__qaTurnstileOptions=[];window.turnstile={render(t,o){const id='qa-'+(++n),m=document.createElement('div');m.className='qa-turnstile';m.hidden=true;t.append(m);widgets.set(id,o);window.__qaTurnstileOptions.push({size:o.size||'',appearance:o.appearance||'',action:o.action||'',sitekey:o.sitekey||''});setTimeout(()=>o.callback?.('qa-token'),0);return id},reset(id){const o=widgets.get(id);setTimeout(()=>o?.callback?.('qa-token-reset'),0)},remove(id){widgets.delete(id)}}})();`
  }));
  await page.route("**/api/comments/v1/**", async route => {
    const request=route.request(), url=new URL(request.url());
    if (request.method()==="GET" && url.pathname.endsWith("/comments")) {
      if (failLoad) return route.fulfill({ status:503, contentType:"application/json", body:JSON.stringify({ ok:false, error:"qa_load_failure", message:"QA load failure" }) });
      return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ok:true, comments }) });
    }
    if (request.method()==="POST" && url.pathname.endsWith("/comments")) {
      const body=JSON.parse(request.postData()||"{}"); submissions.push(body);
      return route.fulfill({ status:201, contentType:"application/json", body:JSON.stringify({ ok:true, id:"33333333-3333-4333-8333-333333333333", status:"pending", managementToken:"qa-management-capability-token-01234567890123456789" }) });
    }
    return route.fulfill({ status:404, body:"not found" });
  });
}

async function waitForHuikai(page) {
  const root=page.locator('.huikai-comments');
  await root.waitFor({ state:"visible", timeout:5000 });
  await page.locator('.qa-turnstile').waitFor({ state:"attached", timeout:5000 });
  await page.waitForFunction(() => !document.querySelector('[data-comments-list]')?.hasAttribute('aria-busy'), { timeout:5000 });
  await page.waitForFunction(() => Array.isArray(window.__qaTurnstileOptions) && window.__qaTurnstileOptions.length > 0, { timeout:5000 });
  return root;
}

async function readHuikaiContract(page) {
  return page.evaluate(() => {
    const root=document.querySelector('.huikai-comments');
    const input=document.querySelector('[data-comments-name]');
    const textarea=document.querySelector('[data-comments-body]');
    const counter=document.querySelector('[data-comments-count]');
    const submit=document.querySelector('[data-comments-submit]');
    const turnstile=document.querySelector('[data-comments-turnstile]');
    const inputLabel=[...document.querySelectorAll('label')].find(item=>item.htmlFor===input?.id);
    const bodyLabel=[...document.querySelectorAll('label')].find(item=>item.htmlFor===textarea?.id);
    const describedBy=(textarea?.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
    const h=el=>el?.getBoundingClientRect().height||0;
    return {
      title:root?.querySelector('h2')?.textContent?.trim()||"",
      key:root?.dataset.commentKey||"",
      api:root?.dataset.apiBase||"",
      giscus:document.querySelectorAll('script[src="https://giscus.app/client.js"]').length,
      htmlInjection:Boolean(document.querySelector('.huikai-comment__body img,.huikai-comment__body script')),
      body:document.querySelector('.huikai-comment__body')?.textContent||"",
      overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),
      input:h(input), textarea:h(textarea), submit:h(submit),
      inputId:input?.id||"", bodyId:textarea?.id||"", counterId:counter?.id||"",
      inputLabel:Boolean(inputLabel), bodyLabel:Boolean(bodyLabel),
      counterInsideLabel:Boolean(counter?.closest('label')),
      counterDescribed:describedBy.includes(counter?.id||""),
      counterText:counter?.textContent?.trim()||"",
      maxLength:textarea?.maxLength??null,
      turnstileWidth:turnstile?.getBoundingClientRect().width||0,
      turnstileOptions:window.__qaTurnstileOptions?.at(-1)||null,
    };
  });
}

function assertHuikaiBase(initial, name, expectedSize) {
  const option=initial.turnstileOptions;
  if (!initial.key.startsWith("notion:") || initial.api !== "/api/comments/v1" || initial.giscus !== 0 || initial.htmlInjection || !initial.body.includes("<img") || initial.overflow > 1 || Math.min(initial.input,initial.textarea,initial.submit) < 44) throw new Error(`HUIKAI comments ${name} contract failed: ${JSON.stringify(initial)}`);
  if (!initial.inputId || !initial.bodyId || !initial.counterId || !initial.inputLabel || !initial.bodyLabel || initial.counterInsideLabel || !initial.counterDescribed || initial.maxLength !== 4000 || initial.counterText !== "0 / 4,000") throw new Error(`HUIKAI form semantics ${name} failed: ${JSON.stringify(initial)}`);
  if (!option || option.appearance !== "interaction-only" || option.action !== "comment-submit" || option.size !== expectedSize) throw new Error(`HUIKAI Turnstile ${name} config failed: ${JSON.stringify({ option, width:initial.turnstileWidth })}`);
}

async function clearHuikaiPreviewFiles() {
  await fs.mkdir(OUTPUT_DIR, { recursive:true });
  for (const name of await fs.readdir(OUTPUT_DIR)) {
    if (/^comments-huikai-.*\.png$/u.test(name)) await fs.rm(path.join(OUTPUT_DIR,name), { force:true });
  }
}

async function verifyHuikaiPopulated(browser) {
  const results=[];
  const cases=[
    ["desktop","light",1440,1000],
    ["desktop","dark",1440,1000],
    ["mobile","light",390,844],
    ["mobile","dark",390,844],
  ];
  for (const [viewportName,colorScheme,width,height] of cases) {
    const context=await browser.newContext({ viewport:{width,height}, colorScheme, reducedMotion:"reduce" });
    const page=await context.newPage(); const submissions=[];
    const name=`${viewportName}-${colorScheme}`;
    try {
      await installHuikaiMocks(page,{submissions});
      const response=await page.goto(`${BASE_URL}${ARTICLE_PATH}`, { waitUntil:"domcontentloaded", timeout:45_000 });
      if (!response?.ok()) throw new Error(`HUIKAI comments QA navigation failed: ${response?.status()}`);
      const actualDark=await ensureTheme(page,colorScheme,name);
      const root=await waitForHuikai(page);
      await page.locator('.huikai-comment').first().waitFor({ state:"visible", timeout:5000 });
      const initial=await readHuikaiContract(page);
      assertHuikaiBase(initial,name,"flexible");
      const screenshot=path.join(OUTPUT_DIR,`comments-huikai-initial-${name}.png`);
      await root.screenshot({path:screenshot});

      await page.locator('.huikai-comment-group').first().locator('button').first().click();
      await page.locator('[data-comments-name]').fill('測試讀者');
      await page.locator('[data-comments-body]').fill('候選版測試回應');
      await page.locator('[data-comments-submit]').click();
      await page.waitForFunction(() => document.querySelector('[data-comments-status]')?.dataset.kind === 'success', { timeout:5000 });
      await page.waitForTimeout(25);
      const afterSubmit=await page.evaluate(() => ({
        text:document.querySelector('[data-comments-status]')?.textContent?.trim()||"",
        kind:document.querySelector('[data-comments-status]')?.dataset.kind||"",
        source:document.querySelector('[data-comments-status]')?.dataset.source||"",
        counter:document.querySelector('[data-comments-count]')?.textContent?.trim()||"",
      }));
      if (submissions.length !== 1 || submissions[0].articleKey !== initial.key || submissions[0].pagePath !== ARTICLE_PATH || submissions[0].parentId !== "11111111-1111-4111-8111-111111111111" || submissions[0].turnstileToken !== "qa-token" || "email" in submissions[0] || "ip" in submissions[0]) throw new Error(`HUIKAI submission contract failed: ${JSON.stringify(submissions)}`);
      if (afterSubmit.kind !== "success" || afterSubmit.source !== "submit" || !afterSubmit.text || afterSubmit.counter !== "0 / 4,000") throw new Error(`HUIKAI submit/reset status contract failed: ${JSON.stringify(afterSubmit)}`);
      const measured=await geometry(page,'.huikai-comments'); assertAligned(measured);
      results.push({name,colorScheme,actualDark,initial,afterSubmit,measured,screenshot});
    } finally { await context.close(); }
  }
  return results;
}

async function verifyHuikaiEmpty(browser) {
  const context=await browser.newContext({ viewport:{width:390,height:844}, colorScheme:"light", reducedMotion:"reduce" });
  const page=await context.newPage();
  try {
    await installHuikaiMocks(page,{comments:[]});
    const response=await page.goto(`${BASE_URL}${ARTICLE_PATH}`, { waitUntil:"domcontentloaded", timeout:45_000 });
    if (!response?.ok()) throw new Error(`HUIKAI empty-state navigation failed: ${response?.status()}`);
    await waitForHuikai(page);
    const state=await page.evaluate(() => ({
      emptyHidden:document.querySelector('[data-comments-empty-summary]')?.hidden ?? true,
      listChildren:document.querySelector('[data-comments-list]')?.children.length ?? -1,
      status:document.querySelector('[data-comments-status]')?.textContent?.trim()||"",
      kind:document.querySelector('[data-comments-status]')?.dataset.kind||"",
    }));
    if (state.emptyHidden || state.listChildren !== 0 || state.status || state.kind) throw new Error(`HUIKAI empty-state contract failed: ${JSON.stringify(state)}`);
    return state;
  } finally { await context.close(); }
}

async function verifyHuikaiLoadFailure(browser) {
  const context=await browser.newContext({ viewport:{width:390,height:844}, colorScheme:"light", reducedMotion:"reduce" });
  const page=await context.newPage();
  try {
    await installHuikaiMocks(page,{failLoad:true});
    const response=await page.goto(`${BASE_URL}${ARTICLE_PATH}`, { waitUntil:"domcontentloaded", timeout:45_000 });
    if (!response?.ok()) throw new Error(`HUIKAI load-error navigation failed: ${response?.status()}`);
    await waitForHuikai(page);
    await page.waitForTimeout(25);
    const state=await page.evaluate(() => {
      const root=document.querySelector('.huikai-comments');
      const status=document.querySelector('[data-comments-status]');
      return {
        emptyHidden:document.querySelector('[data-comments-empty-summary]')?.hidden ?? false,
        listChildren:document.querySelector('[data-comments-list]')?.children.length ?? -1,
        status:status?.textContent?.trim()||"",
        expected:root?.dataset.loadError||"",
        kind:status?.dataset.kind||"",
        source:status?.dataset.source||"",
      };
    });
    if (!state.emptyHidden || state.listChildren !== 0 || state.status !== state.expected || state.kind !== "error" || state.source !== "load") throw new Error(`HUIKAI load-error contract failed: ${JSON.stringify(state)}`);
    return state;
  } finally { await context.close(); }
}

async function verifyHuikaiCompactTurnstile(browser) {
  const context=await browser.newContext({ viewport:{width:280,height:844}, colorScheme:"light", reducedMotion:"reduce" });
  const page=await context.newPage();
  try {
    await installHuikaiMocks(page,{comments:[]});
    const response=await page.goto(`${BASE_URL}${ARTICLE_PATH}`, { waitUntil:"domcontentloaded", timeout:45_000 });
    if (!response?.ok()) throw new Error(`HUIKAI compact navigation failed: ${response?.status()}`);
    await waitForHuikai(page);
    const state=await page.evaluate(() => {
      const target=document.querySelector('[data-comments-turnstile]');
      return {
        width:target?.getBoundingClientRect().width||0,
        option:window.__qaTurnstileOptions?.at(-1)||null,
        overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),
      };
    });
    if (!(state.width > 0 && state.width < 300) || state.option?.size !== "compact" || state.option?.appearance !== "interaction-only" || state.option?.action !== "comment-submit" || state.overflow > 1) throw new Error(`HUIKAI compact Turnstile contract failed: ${JSON.stringify(state)}`);
    return state;
  } finally { await context.close(); }
}

async function verifyHuikai(browser) {
  await clearHuikaiPreviewFiles();
  const populated=await verifyHuikaiPopulated(browser);
  const empty=await verifyHuikaiEmpty(browser);
  const loadFailure=await verifyHuikaiLoadFailure(browser);
  const compact=await verifyHuikaiCompactTurnstile(browser);
  console.log(JSON.stringify({ status:"pass", provider:"huikai", populated, empty, loadFailure, compact }, null, 2));
}

const browser=await chromium.launch({headless:true});
try { if (PROVIDER === "giscus") await verifyGiscus(browser); else if (PROVIDER === "huikai") await verifyHuikai(browser); else throw new Error(`Unsupported COMMENTS_PROVIDER=${PROVIDER}`); }
finally { await browser.close(); }
