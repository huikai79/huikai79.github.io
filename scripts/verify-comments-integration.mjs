#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL = (process.env.LIVE_SITE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const ARTICLE_PATH = process.env.COMMENTS_QA_ARTICLE || "/posts/first-hackathon/";
const PROVIDER = (process.env.COMMENTS_PROVIDER || "giscus").toLowerCase();
const OUTPUT_DIR = path.resolve(process.env.COMMENTS_QA_OUTPUT || process.env.WEEKLY_QA_OUTPUT || "weekly-reader-a11y-qa");

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

async function installHuikaiMocks(page, submissions) {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", route => route.fulfill({
    status:200, contentType:"application/javascript", body:`(()=>{let n=0;window.turnstile={render(t,o){const id='qa-'+(++n),m=document.createElement('div');m.className='qa-turnstile';t.append(m);setTimeout(()=>o.callback?.('qa-token'),0);return id},reset(){},remove(){}}})();`
  }));
  await page.route("**/api/comments/v1/**", async route => {
    const request=route.request(), url=new URL(request.url());
    if (request.method()==="GET" && url.pathname.endsWith("/comments")) return route.fulfill({ status:200, contentType:"application/json", body:JSON.stringify({ ok:true, comments:[{ id:"11111111-1111-4111-8111-111111111111", parentId:null, displayName:"讀者甲", body:"<img src=x onerror=alert(1)> 必須是純文字", isAuthor:false, createdAt:"2026-09-10T00:00:00.000Z", withdrawn:false },{ id:"22222222-2222-4222-8222-222222222222", parentId:"11111111-1111-4111-8111-111111111111", displayName:"HUIKAI", body:"作者補充", isAuthor:true, createdAt:"2026-09-10T00:01:00.000Z", withdrawn:false }] }) });
    if (request.method()==="POST" && url.pathname.endsWith("/comments")) { const body=JSON.parse(request.postData()||"{}"); submissions.push(body); return route.fulfill({ status:201, contentType:"application/json", body:JSON.stringify({ ok:true, id:"33333333-3333-4333-8333-333333333333", status:"pending", managementToken:"qa-management-capability-token-01234567890123456789" }) }); }
    return route.fulfill({ status:404, body:"not found" });
  });
}

async function verifyHuikai(browser) {
  await fs.mkdir(OUTPUT_DIR, { recursive:true });
  const results=[];
  for (const [name,width,height] of [["desktop",1440,1000],["mobile",390,844]]) {
    const context=await browser.newContext({ viewport:{width,height}, colorScheme:"dark", reducedMotion:"reduce" });
    const page=await context.newPage(); const submissions=[];
    try {
      await installHuikaiMocks(page, submissions);
      const response=await page.goto(`${BASE_URL}${ARTICLE_PATH}`, { waitUntil:"domcontentloaded", timeout:45_000 });
      if (!response?.ok()) throw new Error(`HUIKAI comments QA navigation failed: ${response?.status()}`);
      const root=page.locator('.huikai-comments'); await root.waitFor({ state:"visible", timeout:5000 });
      await page.locator('.qa-turnstile').waitFor({ state:"attached", timeout:5000 });
      await page.locator('.huikai-comment').first().waitFor({ state:"visible", timeout:5000 });
      const initial=await page.evaluate(() => {
        const root=document.querySelector('.huikai-comments'), input=document.querySelector('[data-comments-name]'), textarea=document.querySelector('[data-comments-body]'), submit=document.querySelector('[data-comments-submit]');
        const h=el=>el?.getBoundingClientRect().height||0;
        return { title:root?.querySelector('h2')?.textContent?.trim()||"", key:root?.dataset.commentKey||"", api:root?.dataset.apiBase||"", giscus:document.querySelectorAll('script[src="https://giscus.app/client.js"]').length, htmlInjection:Boolean(document.querySelector('.huikai-comment__body img,.huikai-comment__body script')), body:document.querySelector('.huikai-comment__body')?.textContent||"", overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth), input:h(input), textarea:h(textarea), submit:h(submit) };
      });
      if (!initial.key.startsWith("notion:") || initial.api !== "/api/comments/v1" || initial.giscus !== 0 || initial.htmlInjection || !initial.body.includes("<img") || initial.overflow > 1 || Math.min(initial.input,initial.textarea,initial.submit) < 44) throw new Error(`HUIKAI comments ${name} contract failed: ${JSON.stringify(initial)}`);
      await page.locator('.huikai-comment-group').first().locator('button').first().click();
      await page.locator('[data-comments-name]').fill('測試讀者'); await page.locator('[data-comments-body]').fill('候選版測試回應'); await page.locator('[data-comments-submit]').click();
      await page.waitForFunction(() => document.querySelector('[data-comments-status]')?.dataset.kind === 'success', { timeout:5000 });
      if (submissions.length !== 1 || submissions[0].articleKey !== initial.key || submissions[0].pagePath !== ARTICLE_PATH || submissions[0].parentId !== "11111111-1111-4111-8111-111111111111" || submissions[0].turnstileToken !== "qa-token" || "email" in submissions[0] || "ip" in submissions[0]) throw new Error(`HUIKAI submission contract failed: ${JSON.stringify(submissions)}`);
      const measured=await geometry(page,'.huikai-comments'); assertAligned(measured);
      const screenshot=path.join(OUTPUT_DIR,`comments-huikai-preview-${name}.png`); await root.screenshot({path:screenshot});
      results.push({name,initial,measured,screenshot});
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ status:"pass", provider:"huikai", results }, null, 2));
}

const browser=await chromium.launch({headless:true});
try { if (PROVIDER === "giscus") await verifyGiscus(browser); else if (PROVIDER === "huikai") await verifyHuikai(browser); else throw new Error(`Unsupported COMMENTS_PROVIDER=${PROVIDER}`); }
finally { await browser.close(); }
