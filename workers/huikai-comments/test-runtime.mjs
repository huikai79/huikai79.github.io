#!/usr/bin/env node
import assert from "node:assert/strict";
import worker, {
  handleRequest,
  normalizeBody,
  publishedArticleAllowsComments,
  reservedNameKey,
  sha256Hex,
  validArticleKey,
  validArticlePath,
  validBody,
  validDisplayName,
} from "./index.js";

const ARTICLE = "notion:3d07a59e-0439-8048-ae89-da587d3ba5d0";
const ARTICLE_B = "notion:4d07a59e-0439-8048-ae89-da587d3ba5d1";
const PATH = "/posts/first-hackathon/";
const PATH_B = "/posts/second-article/";
const ORIGIN = "https://huikai.com.kg";
const ADMIN = "admin-test-token-with-enough-entropy";

function compareRows(a, b) {
  return String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
}

function isEffectiveVisible(db, row) {
  if (!["approved", "withdrawn"].includes(row.status)) return false;
  if (!row.parent_id) return true;
  const root = db.rows.find(item => item.id === row.parent_id);
  return Boolean(root && ["approved", "withdrawn"].includes(root.status));
}

function decorate(db, row) {
  const root = row.parent_id ? db.rows.find(item => item.id === row.parent_id) : null;
  const target = row.reply_to_id ? db.rows.find(item => item.id === row.reply_to_id) : null;
  return {
    ...row,
    root_display_name: root?.display_name ?? null,
    root_status: root?.status ?? null,
    root_removed_by_admin: root?.removed_by_admin ?? null,
    reply_to_display_name: target?.display_name ?? null,
    reply_to_status: target?.status ?? null,
    reply_to_is_author: target?.is_author ?? null,
    reply_to_removed_by_admin: target?.removed_by_admin ?? null,
    effective_visible: isEffectiveVisible(db, row) ? 1 : 0,
  };
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.args = [];
  }
  bind(...args) { this.args = args; return this; }

  async all() {
    if (this.sql.includes("GROUP BY c.article_key")) {
      const [limit, offset] = this.args;
      const visible = this.db.rows.filter(row => isEffectiveVisible(this.db, row));
      const groups = new Map();
      for (const item of visible) {
        const current = groups.get(item.article_key) || [];
        current.push(item);
        groups.set(item.article_key, current);
      }
      const results = [...groups.entries()].map(([articleKey, rows]) => {
        const latest = [...rows].sort(compareRows).at(-1);
        const latestPath = this.db.rows
          .filter(item => item.article_key === articleKey && item.page_path)
          .sort(compareRows)
          .at(-1)?.page_path || null;
        return {
          article_key: articleKey,
          comment_count: rows.length,
          thread_count: rows.filter(item => !item.parent_id).length,
          latest_at: latest?.created_at || null,
          page_path: latestPath,
        };
      }).sort((a, b) => String(b.latest_at).localeCompare(String(a.latest_at)) || a.article_key.localeCompare(b.article_key));
      return { results: results.slice(Number(offset), Number(offset) + Number(limit)) };
    }

    if (this.sql.includes("FROM comments c") && this.sql.includes("ORDER BY c.created_at ASC")) {
      const articleConversation = this.sql.includes("c.status IN ('approved', 'withdrawn')") && this.sql.includes("c.article_key = ?");
      const hasArticleFilter = this.sql.includes("c.article_key = ?");
      let rows;
      let limit;
      let offset;
      if (articleConversation) {
        const [articleKey, argLimit, argOffset] = this.args;
        rows = this.db.rows.filter(row => row.article_key === articleKey && isEffectiveVisible(this.db, row));
        limit = argLimit;
        offset = argOffset;
      } else if (hasArticleFilter) {
        const [status, articleKey, argLimit, argOffset] = this.args;
        rows = this.db.rows.filter(row => row.status === status && row.article_key === articleKey);
        limit = argLimit;
        offset = argOffset;
      } else {
        const [status, argLimit, argOffset] = this.args;
        rows = this.db.rows.filter(row => row.status === status);
        limit = argLimit;
        offset = argOffset;
      }
      return {
        results: rows.sort(compareRows).slice(Number(offset), Number(offset) + Number(limit)).map(row => decorate(this.db, row)),
      };
    }

    if (this.sql.includes("FROM comments") && this.sql.includes("status IN ('approved', 'withdrawn')") && !this.sql.includes("FROM comments c")) {
      const [key, limit] = this.args;
      return {
        results: this.db.rows
          .filter(row => row.article_key === key && ["approved", "withdrawn"].includes(row.status))
          .sort(compareRows)
          .slice(0, Number(limit)),
      };
    }

    throw new Error(`Unhandled all query: ${this.sql}`);
  }

  async first() {
    if (this.sql.includes("COUNT(*) AS total FROM ( SELECT c.article_key")) {
      const keys = new Set(this.db.rows.filter(row => isEffectiveVisible(this.db, row)).map(row => row.article_key));
      return { total: keys.size };
    }

    if (this.sql.includes("SELECT COUNT(*) AS total") && this.sql.includes("FROM comments c")) {
      const articleConversation = this.sql.includes("c.status IN ('approved', 'withdrawn')") && this.sql.includes("c.article_key = ?");
      const hasArticleFilter = this.sql.includes("c.article_key = ?");
      let rows;
      if (articleConversation) {
        const [articleKey] = this.args;
        rows = this.db.rows.filter(row => row.article_key === articleKey && isEffectiveVisible(this.db, row));
      } else if (hasArticleFilter) {
        const [status, articleKey] = this.args;
        rows = this.db.rows.filter(row => row.status === status && row.article_key === articleKey);
      } else {
        const [status] = this.args;
        rows = this.db.rows.filter(row => row.status === status);
      }
      return { total: rows.length };
    }

    if (this.sql.includes("id != ? AND (parent_id = ? OR reply_to_id = ?)")) {
      const [notId, parentId, replyToId] = this.args;
      return this.db.rows.find(row => row.id !== notId && (row.parent_id === parentId || row.reply_to_id === replyToId)) || null;
    }
    if (this.sql.includes("WHERE id = ? AND article_key = ?")) {
      const [id, key] = this.args;
      return this.db.rows.find(row => row.id === id && row.article_key === key) || null;
    }
    if (this.sql.includes("WHERE id = ?")) {
      return this.db.rows.find(row => row.id === this.args[0]) || null;
    }
    throw new Error(`Unhandled first query: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO comments") && this.sql.includes("'pending'")) {
      const [id, key, parentId, replyToId, pagePath, name, body, hash, created] = this.args;
      this.db.rows.push({ id, article_key: key, parent_id: parentId, reply_to_id: replyToId, page_path: pagePath, display_name: name, body, status: "pending", is_author: 0, manage_token_hash: hash, created_at: created, moderated_at: null, removed_by_admin: 0 });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO comments") && this.sql.includes("'HUIKAI'")) {
      const [id, key, parentId, replyToId, pagePath, body, created, moderated] = this.args;
      this.db.rows.push({ id, article_key: key, parent_id: parentId, reply_to_id: replyToId, page_path: pagePath, display_name: "HUIKAI", body, status: "approved", is_author: 1, manage_token_hash: null, created_at: created, moderated_at: moderated, removed_by_admin: 0 });
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM comments")) {
      this.db.rows = this.db.rows.filter(row => row.id !== this.args[0]);
      return { success: true };
    }
    if (this.sql.includes("removed_by_admin = 0") && this.sql.includes("status = 'withdrawn'")) {
      const [moderated, id] = this.args;
      const item = this.db.rows.find(row => row.id === id);
      if (item) Object.assign(item, { status: "withdrawn", display_name: "", body: "", manage_token_hash: null, removed_by_admin: 0, moderated_at: moderated });
      return { success: true };
    }
    if (this.sql.includes("removed_by_admin = 1") && this.sql.includes("status = 'withdrawn'")) {
      const [moderated, id] = this.args;
      const item = this.db.rows.find(row => row.id === id);
      if (item) Object.assign(item, { status: "withdrawn", display_name: "", body: "", manage_token_hash: null, removed_by_admin: 1, moderated_at: moderated });
      return { success: true };
    }
    if (this.sql.includes("SET status = ?, moderated_at = ?")) {
      const [status, moderated, id] = this.args;
      const item = this.db.rows.find(row => row.id === id);
      if (item) Object.assign(item, { status, moderated_at: moderated });
      return { success: true };
    }
    throw new Error(`Unhandled run query: ${this.sql}`);
  }
}

class DB {
  constructor(rows = []) { this.rows = structuredClone(rows); }
  prepare(sql) { return new Statement(this, sql); }
}

function row(overrides = {}) {
  return {
    id: crypto.randomUUID(), article_key: ARTICLE, parent_id: null, reply_to_id: null, page_path: PATH,
    display_name: "讀者", body: "內容", status: "approved", is_author: 0, manage_token_hash: null,
    created_at: "2026-09-10T00:00:00.000Z", moderated_at: null, removed_by_admin: 0, ...overrides,
  };
}

function req(path, { method = "GET", body = null, headers = {} } = {}) {
  const init = { method, headers: new Headers(headers) };
  if (body !== null) {
    init.body = JSON.stringify(body);
    init.headers.set("content-type", "application/json");
  }
  return new Request(`${ORIGIN}${path}`, init);
}

function post(body, headers = {}) {
  return req("/api/comments/v1/comments", { method: "POST", body, headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "CF-Connecting-IP": "203.0.113.9", ...headers } });
}

function adminReq(path, { method = "GET", body = null } = {}) {
  return req(path, { method, body, headers: { Authorization: `Bearer ${ADMIN}` } });
}

function env(db) {
  return { DB: db, TURNSTILE_SECRET: "test-secret", COMMENTS_ADMIN_TOKEN: ADMIN, COMMENT_RATE_LIMITER: { limit: async () => ({ success: true }) }, SOURCE_SHA: "test-sha" };
}

async function json(response) { return response.json(); }

let articleHtml = `<main><section data-comment-key="${ARTICLE}"></section></main>`;
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = typeof input === "string" ? input : input.url;
  if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    return new Response(JSON.stringify({ success: true, hostname: "huikai.com.kg", action: "comment-submit" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url === `${ORIGIN}${PATH}`) return new Response(articleHtml, { status: 200 });
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

  articleHtml = `<main data-comment-key="${ARTICLE}"></main>`;
  assert.equal(await publishedArticleAllowsComments(ARTICLE, PATH), true);
  articleHtml = `<main data-comment-key='${ARTICLE}'></main>`;
  assert.equal(await publishedArticleAllowsComments(ARTICLE, PATH), true);
  articleHtml = `<main data-comment-key=${ARTICLE}></main>`;
  assert.equal(await publishedArticleAllowsComments(ARTICLE, PATH), true);
  articleHtml = `<main data-comment-key=${ARTICLE}-extra></main>`;
  assert.equal(await publishedArticleAllowsComments(ARTICLE, PATH), false);
  articleHtml = `<main><section data-comment-key="${ARTICLE}"></section></main>`;

  let response = await worker.fetch(req("/api/comments/v1/health"), env(new DB()));
  assert.equal(response.status, 200);
  assert.equal((await json(response)).version, 1);

  response = await worker.fetch(req("/api/comments/v1/comments", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    body: { articleKey: ARTICLE, pagePath: PATH, displayName: "甲", body: "hello", turnstileToken: "token" },
  }), env(new DB()));
  assert.equal(response.status, 403);

  const db = new DB();
  response = await worker.fetch(post({ articleKey: ARTICLE, pagePath: PATH, displayName: "  讀者   甲 ", body: "第一行\r\n第二行 <b>也是文字</b>", turnstileToken: "token" }), env(db));
  assert.equal(response.status, 201);
  const submitted = await json(response);
  assert.equal(submitted.status, "pending");
  assert.ok(submitted.managementToken.length >= 40);
  assert.equal(db.rows[0].display_name, "讀者 甲");
  assert.equal(db.rows[0].body, "第一行\n第二行 <b>也是文字</b>");
  assert.equal(db.rows[0].page_path, PATH);
  assert.equal(db.rows[0].parent_id, null);
  assert.equal(db.rows[0].reply_to_id, null);
  assert.equal(db.rows[0].manage_token_hash, await sha256Hex(submitted.managementToken));

  response = await handleRequest(req(`/api/comments/v1/comments/${db.rows[0].id}/withdraw`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "X-Comment-Manage-Token": submitted.managementToken },
    body: {},
  }), env(db));
  assert.equal(response.status, 200);
  assert.equal(db.rows.length, 0, "pending withdrawal must hard delete");

  const rootId = "11111111-1111-4111-8111-111111111111";
  const authorId = "22222222-2222-4222-8222-222222222222";
  const readerReplyId = "33333333-3333-4333-8333-333333333333";
  const thread = new DB([
    row({ id: rootId, display_name: "王小明", body: "根留言" }),
    row({ id: authorId, parent_id: rootId, reply_to_id: rootId, display_name: "HUIKAI", body: "作者回覆", is_author: 1, created_at: "2026-09-10T00:01:00.000Z" }),
  ]);

  response = await worker.fetch(post({ articleKey: ARTICLE, pagePath: PATH, displayName: "王小明", body: "讀者再次回覆", replyToId: authorId, turnstileToken: "token" }), env(thread));
  assert.equal(response.status, 201);
  const nestedSubmission = thread.rows.at(-1);
  assert.equal(nestedSubmission.parent_id, rootId);
  assert.equal(nestedSubmission.reply_to_id, authorId);
  nestedSubmission.id = readerReplyId;

  response = await handleRequest(adminReq(`/api/comments/v1/admin/comments/${readerReplyId}/approve`, { method: "POST", body: {} }), env(thread));
  assert.equal(response.status, 200);
  assert.equal(nestedSubmission.status, "approved");

  response = await handleRequest(adminReq("/api/comments/v1/admin/replies", { method: "POST", body: { articleKey: ARTICLE, replyToId: readerReplyId, body: "作者第三輪回覆" } }), env(thread));
  assert.equal(response.status, 201);
  const authorThird = thread.rows.at(-1);
  assert.equal(authorThird.parent_id, rootId);
  assert.equal(authorThird.reply_to_id, readerReplyId);
  assert.equal(authorThird.is_author, 1);

  response = await handleRequest(adminReq("/api/comments/v1/admin/comments?status=approved&limit=100&offset=0"), env(thread));
  let payload = await json(response);
  assert.equal(response.status, 200);
  assert.equal(payload.total, 4);
  assert.equal(payload.hasMore, false);
  assert.equal(payload.comments.find(item => item.id === authorThird.id).effective_visible, 1);

  const hiddenRoot = row({ id: "66666666-6666-4666-8666-666666666666", status: "hidden", created_at: "2026-09-10T00:05:00.000Z" });
  const suppressedChild = row({ id: "77777777-7777-4777-8777-777777777777", parent_id: hiddenRoot.id, reply_to_id: hiddenRoot.id, created_at: "2026-09-10T00:06:00.000Z" });
  const tombstone = row({ id: "88888888-8888-4888-8888-888888888888", parent_id: rootId, reply_to_id: authorId, status: "withdrawn", display_name: "", body: "", removed_by_admin: 0, created_at: "2026-09-10T00:07:00.000Z" });
  const articleBRoot = row({ id: "99999999-9999-4999-8999-999999999999", article_key: ARTICLE_B, page_path: PATH_B, created_at: "2026-09-12T00:00:00.000Z" });
  thread.rows.push(hiddenRoot, suppressedChild, tombstone, articleBRoot);

  response = await handleRequest(adminReq("/api/comments/v1/admin/articles?status=approved&limit=1&offset=0"), env(thread));
  payload = await json(response);
  assert.equal(response.status, 200);
  assert.equal(payload.total, 2);
  assert.equal(payload.articles.length, 1);
  assert.equal(payload.articles[0].article_key, ARTICLE_B, "latest active article must come first");
  assert.equal(payload.hasMore, true);

  response = await handleRequest(adminReq("/api/comments/v1/admin/articles?status=approved&limit=1&offset=1"), env(thread));
  payload = await json(response);
  assert.equal(payload.articles[0].article_key, ARTICLE);
  assert.equal(payload.articles[0].comment_count, 5, "hidden root and approved suppressed child must not count as effectively public");
  assert.equal(payload.articles[0].thread_count, 1);
  assert.equal(payload.hasMore, false);

  response = await handleRequest(adminReq(`/api/comments/v1/admin/comments?status=approved&articleKey=${encodeURIComponent(ARTICLE)}&limit=3&offset=0`), env(thread));
  payload = await json(response);
  assert.equal(response.status, 200);
  assert.equal(payload.total, 5);
  assert.equal(payload.comments.length, 3);
  assert.equal(payload.hasMore, true);
  assert.equal(payload.comments.some(item => item.id === suppressedChild.id), false);
  const firstConversationPage = payload.comments;

  response = await handleRequest(adminReq(`/api/comments/v1/admin/comments?status=approved&articleKey=${encodeURIComponent(ARTICLE)}&limit=3&offset=3`), env(thread));
  payload = await json(response);
  assert.equal(payload.comments.length, 2);
  assert.equal([...firstConversationPage, ...payload.comments].some(item => item.id === tombstone.id), true, "article conversation must include visible tombstones");
  assert.equal(payload.hasMore, false);

  const many = new DB(Array.from({ length: 101 }, (_, index) => row({
    id: `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
    created_at: `2026-09-10T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  })));
  response = await handleRequest(adminReq("/api/comments/v1/admin/comments?status=approved&limit=100&offset=100"), env(many));
  payload = await json(response);
  assert.equal(payload.total, 101);
  assert.equal(payload.comments.length, 1, "101st comment must remain reachable through pagination");
  assert.equal(payload.hasMore, false);

  response = await handleRequest(adminReq("/api/comments/v1/admin/comments?status=approved&articleKey=bad-key"), env(thread));
  assert.equal(response.status, 400);

  const leaf = row({ id: "44444444-4444-4444-8444-444444444444", parent_id: rootId, reply_to_id: rootId, created_at: "2026-09-10T00:08:00.000Z" });
  thread.rows.push(leaf);
  response = await handleRequest(adminReq(`/api/comments/v1/admin/comments/${leaf.id}/delete`, { method: "POST", body: {} }), env(thread));
  assert.equal((await json(response)).deleted, "hard");

  response = await handleRequest(adminReq(`/api/comments/v1/admin/comments/${rootId}/delete`, { method: "POST", body: {} }), env(thread));
  payload = await json(response);
  assert.equal(payload.deleted, "tombstone");
  const removedRoot = thread.rows.find(item => item.id === rootId);
  assert.equal(removedRoot.status, "withdrawn");
  assert.equal(removedRoot.removed_by_admin, 1);

  response = await handleRequest(req(`/api/comments/v1/comments?articleKey=${encodeURIComponent(ARTICLE)}`), env(thread));
  payload = await json(response);
  assert.equal(payload.comments.find(item => item.id === rootId).removed, true);
  assert.equal(payload.comments.some(item => item.id === authorId), true);

  const approvedCap = "capability-token-for-approved-comment-000000000000000000";
  const approvedCapHash = await sha256Hex(approvedCap);
  const withdrawDb = new DB([row({ id: "55555555-5555-4555-8555-555555555555", manage_token_hash: approvedCapHash })]);
  response = await handleRequest(req("/api/comments/v1/comments/55555555-5555-4555-8555-555555555555/withdraw", {
    method: "POST",
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "X-Comment-Manage-Token": approvedCap },
    body: {},
  }), env(withdrawDb));
  assert.equal(response.status, 200);
  assert.equal(withdrawDb.rows[0].status, "withdrawn");
  assert.equal(withdrawDb.rows[0].removed_by_admin, 0);

  console.log("HUIKAI comments Worker runtime tests: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
