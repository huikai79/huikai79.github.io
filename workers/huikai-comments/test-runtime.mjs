#!/usr/bin/env node
import assert from "node:assert/strict";
import worker, { handleRequest, normalizeBody, reservedNameKey, sha256Hex, validArticleKey, validArticlePath, validBody, validDisplayName } from "./index.js";

const ARTICLE = "notion:3d07a59e-0439-8048-ae89-da587d3ba5d0";
const PATH = "/posts/first-hackathon/";
const ORIGIN = "https://huikai.com.kg";

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.args = []; }
  bind(...args) { this.args = args; return this; }
  async all() {
    if (this.sql.includes("status IN ('approved', 'withdrawn')")) {
      const [key, limit] = this.args;
      return { results: this.db.rows.filter(row => row.article_key === key && ["approved", "withdrawn"].includes(row.status)).slice(0, Number(limit)) };
    }
    if (this.sql.includes("WHERE status = 'pending'")) {
      const [limit] = this.args;
      return { results: this.db.rows.filter(row => row.status === "pending").slice(0, Number(limit)) };
    }
    throw new Error(`Unhandled all query: ${this.sql}`);
  }
  async first() {
    if (this.sql.includes("WHERE id = ? AND article_key = ?")) {
      const [id, key] = this.args;
      return this.db.rows.find(row => row.id === id && row.article_key === key) || null;
    }
    if (this.sql.includes("WHERE id = ?")) return this.db.rows.find(row => row.id === this.args[0]) || null;
    throw new Error(`Unhandled first query: ${this.sql}`);
  }
  async run() {
    if (this.sql.startsWith("INSERT INTO comments") && this.sql.includes("'pending'")) {
      const [id, key, parent, name, body, hash, created] = this.args;
      this.db.rows.push({ id, article_key:key, parent_id:parent, display_name:name, body, status:"pending", is_author:0, manage_token_hash:hash, created_at:created, moderated_at:null });
      return { success:true };
    }
    if (this.sql.startsWith("INSERT INTO comments") && this.sql.includes("'HUIKAI'")) {
      const [id, key, parent, body, created, moderated] = this.args;
      this.db.rows.push({ id, article_key:key, parent_id:parent, display_name:"HUIKAI", body, status:"approved", is_author:1, manage_token_hash:null, created_at:created, moderated_at:moderated });
      return { success:true };
    }
    if (this.sql.startsWith("DELETE FROM comments")) { this.db.rows = this.db.rows.filter(row => row.id !== this.args[0]); return { success:true }; }
    if (this.sql.includes("SET status = 'withdrawn'")) {
      const [moderated, id] = this.args; const row = this.db.rows.find(item => item.id === id);
      if (row) Object.assign(row, { status:"withdrawn", display_name:"", body:"", manage_token_hash:null, moderated_at:moderated });
      return { success:true };
    }
    if (this.sql.includes("SET status = ?, moderated_at = ?")) {
      const [status, moderated, id] = this.args; const row = this.db.rows.find(item => item.id === id);
      if (row) Object.assign(row, { status, moderated_at:moderated });
      return { success:true };
    }
    throw new Error(`Unhandled run query: ${this.sql}`);
  }
}
class DB { constructor(rows=[]) { this.rows = structuredClone(rows); } prepare(sql) { return new Statement(this, sql); } }

function req(path, { method="GET", body=null, headers={} }={}) {
  const init = { method, headers:new Headers(headers) };
  if (body !== null) { init.body = JSON.stringify(body); init.headers.set("content-type", "application/json"); }
  return new Request(`${ORIGIN}${path}`, init);
}
function post(body, headers={}) { return req("/api/comments/v1/comments", { method:"POST", body, headers:{ Origin:ORIGIN, "Sec-Fetch-Site":"same-origin", "CF-Connecting-IP":"203.0.113.9", ...headers } }); }
function env(db) { return { DB:db, TURNSTILE_SECRET:"test-secret", COMMENTS_ADMIN_TOKEN:"admin-test-token-with-enough-entropy", COMMENT_RATE_LIMITER:{ limit:async()=>({success:true}) }, SOURCE_SHA:"test-sha" }; }

const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = typeof input === "string" ? input : input.url;
  if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return new Response(JSON.stringify({ success:true, hostname:"huikai.com.kg", action:"comment-submit" }), { status:200, headers:{"content-type":"application/json"} });
  if (url === `${ORIGIN}${PATH}`) return new Response(`<main><section data-comment-key="${ARTICLE}"></section></main>`, { status:200 });
  throw new Error(`Unexpected fetch: ${url}`);
};

try {
  assert.equal(validArticleKey(ARTICLE), true);
  assert.equal(validArticleKey("post:abc"), false);
  assert.equal(validArticlePath(PATH), true);
  assert.equal(validArticlePath("/zh-cn/posts/first-hackathon/"), true);
  assert.equal(validArticlePath("/projects/x/"), false);
  assert.equal(validDisplayName("讀者甲"), true);
  assert.equal(validDisplayName("HUIKAI"), false);
  assert.equal(validDisplayName("作者"), false);
  assert.equal(reservedNameKey("HUI KAI"), "huikai");
  assert.equal(normalizeBody(" hello\r\nworld "), "hello\nworld");
  assert.equal(validBody("a".repeat(4000)), true);
  assert.equal(validBody("a".repeat(4001)), false);

  let response = await worker.fetch(req("/api/comments/v1/health"), env(new DB()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, "huikai-comments");

  response = await worker.fetch(req("/api/comments/v1/comments", { method:"POST", headers:{ Origin:"https://evil.example", "Sec-Fetch-Site":"cross-site" }, body:{ articleKey:ARTICLE, pagePath:PATH, displayName:"甲", body:"hello", turnstileToken:"token" } }), env(new DB()));
  assert.equal(response.status, 403);

  response = await worker.fetch(post({ articleKey:ARTICLE, pagePath:PATH, displayName:"HUIKAI", body:"impersonation", turnstileToken:"token" }), env(new DB()));
  assert.equal(response.status, 400);

  const db = new DB();
  response = await worker.fetch(post({ articleKey:ARTICLE, pagePath:PATH, displayName:"  讀者   甲 ", body:"第一行\r\n第二行 <b>也是文字</b>", turnstileToken:"token" }), env(db));
  assert.equal(response.status, 201);
  const submitted = await response.json();
  assert.equal(submitted.status, "pending");
  assert.ok(submitted.managementToken.length >= 40);
  assert.equal(db.rows[0].display_name, "讀者 甲");
  assert.equal(db.rows[0].body, "第一行\n第二行 <b>也是文字</b>");
  assert.equal("email" in db.rows[0], false);
  assert.equal("ip" in db.rows[0], false);
  assert.equal(db.rows[0].manage_token_hash, await sha256Hex(submitted.managementToken));

  response = await handleRequest(req(`/api/comments/v1/comments/${db.rows[0].id}/withdraw`, { method:"POST", headers:{ Origin:ORIGIN, "Sec-Fetch-Site":"same-origin", "X-Comment-Manage-Token":submitted.managementToken }, body:{} }), env(db));
  assert.equal(response.status, 200);
  assert.equal(db.rows.length, 0);

  const topId = "11111111-1111-4111-8111-111111111111";
  const approved = new DB([{ id:topId, article_key:ARTICLE, parent_id:null, display_name:"甲", body:"<img src=x onerror=alert(1)>", status:"approved", is_author:0, manage_token_hash:null, created_at:"2026-09-10T00:00:00.000Z", moderated_at:null }]);
  response = await handleRequest(req(`/api/comments/v1/comments?articleKey=${encodeURIComponent(ARTICLE)}`), env(approved));
  const publicPayload = await response.json();
  assert.equal(publicPayload.comments.length, 1);
  assert.equal(publicPayload.comments[0].body.includes("<img"), true);

  response = await handleRequest(req("/api/comments/v1/admin/replies", { method:"POST", headers:{ Authorization:"Bearer admin-test-token-with-enough-entropy" }, body:{ articleKey:ARTICLE, parentId:topId, body:"作者補充" } }), env(approved));
  assert.equal(response.status, 201);
  assert.equal(approved.rows.at(-1).is_author, 1);
  assert.equal(approved.rows.at(-1).status, "approved");

  console.log("HUIKAI comments Worker runtime tests: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
