const SITE_ORIGIN = "https://huikai.com.kg";
const API_PREFIX = "/api/comments/v1";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "comment-submit";
const MAX_NAME_LENGTH = 40;
const MAX_BODY_LENGTH = 4000;
const MAX_REQUEST_BYTES = 12_000;
const PUBLIC_COMMENT_LIMIT = 300;
const ADMIN_PENDING_LIMIT = 100;
const ARTICLE_KEY_RE = /^notion:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESERVED_NAMES = new Set([
  "huikai",
  "huikai作者",
  "huikai官方",
  "作者",
  "站長",
  "站长",
  "管理員",
  "管理员",
  "admin",
  "administrator",
  "moderator",
]);

function responseJson(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorJson(code, message, status = 400, extraHeaders = {}) {
  return responseJson({ ok: false, error: code, message }, status, extraHeaders);
}

function normalizeName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function reservedNameKey(value) {
  return normalizeName(value)
    .toLocaleLowerCase("en-US")
    .replace(/[\s._\-·—–]+/g, "");
}

function validDisplayName(value) {
  const name = normalizeName(value);
  if (!name || name.length > MAX_NAME_LENGTH) return false;
  if (/[\u0000-\u001F\u007F]/u.test(name)) return false;
  const key = reservedNameKey(name);
  if (RESERVED_NAMES.has(key) || key.startsWith("huikai")) return false;
  return true;
}

function normalizeBody(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function validBody(value) {
  const body = normalizeBody(value);
  if (!body || body.length > MAX_BODY_LENGTH) return false;
  const controlChars = body.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu) || [];
  if (controlChars.length) return false;
  return true;
}

function validArticleKey(value) {
  return ARTICLE_KEY_RE.test(String(value ?? ""));
}

function validCommentId(value) {
  return COMMENT_ID_RE.test(String(value ?? ""));
}

function validArticlePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || !value.endsWith("/")) return false;
  if (value.includes("//") || /[?#\\\u0000-\u001F\u007F]/u.test(value)) return false;
  const parts = value.slice(1, -1).split("/");
  let slug = "";
  if (parts.length === 2 && parts[0] === "posts") {
    slug = parts[1];
  } else if (parts.length === 3 && ["zh-cn", "en"].includes(parts[0]) && parts[1] === "posts") {
    slug = parts[2];
  } else {
    return false;
  }
  if (!slug || slug === "." || slug === "..") return false;
  try {
    const decoded = decodeURIComponent(slug);
    if (!decoded || decoded === "." || decoded === "..") return false;
    if (decoded.includes("/") || decoded.includes("\\") || /[?#\u0000-\u001F\u007F]/u.test(decoded)) return false;
  } catch {
    return false;
  }
  return !/%2f|%5c/i.test(slug);
}

function stateChangingRequestIsSameOrigin(request) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin !== SITE_ORIGIN) return false;
  if (fetchSite && !["same-origin", "same-site"].includes(fetchSite)) return false;
  return true;
}

function constantTimeEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function newCapabilityToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function verifyTurnstile(token, env) {
  if (!env.TURNSTILE_SECRET) return { ok: false, reason: "missing-secret" };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, reason: "missing-token" };

  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  let response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch {
    return { ok: false, reason: "verify-unreachable" };
  }
  if (!response.ok) return { ok: false, reason: `verify-http-${response.status}` };
  const result = await response.json().catch(() => null);
  if (!result?.success) return { ok: false, reason: "challenge-failed" };
  if (result.hostname !== "huikai.com.kg") return { ok: false, reason: "hostname-mismatch" };
  if (result.action !== TURNSTILE_ACTION) return { ok: false, reason: "action-mismatch" };
  return { ok: true };
}

function articleMarkerPattern(articleKey) {
  const escaped = articleKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`data-comment-key\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped}(?=[\\s>]))`, "i");
}

async function publishedArticleAllowsComments(articleKey, pagePath) {
  if (!validArticleKey(articleKey) || !validArticlePath(pagePath)) return false;
  let response;
  try {
    response = await fetch(`${SITE_ORIGIN}${pagePath}`, {
      headers: { "User-Agent": "huikai-comments/1" },
      cf: { cacheEverything: true, cacheTtl: 120 },
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;
  const html = await response.text();
  return articleMarkerPattern(articleKey).test(html);
}

async function rateLimitSubmission(request, env) {
  if (!env.COMMENT_RATE_LIMITER?.limit) return true;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    const result = await env.COMMENT_RATE_LIMITER.limit({ key: `submit:${ip}` });
    return Boolean(result?.success);
  } catch {
    return true;
  }
}

function publicComment(row) {
  const withdrawn = row.status === "withdrawn";
  return {
    id: row.id,
    parentId: row.parent_id || null,
    displayName: withdrawn ? "" : row.display_name,
    body: withdrawn ? "" : row.body,
    isAuthor: Boolean(row.is_author),
    createdAt: row.created_at,
    withdrawn,
  };
}

async function listPublicComments(url, env) {
  const articleKey = url.searchParams.get("articleKey") || "";
  if (!validArticleKey(articleKey)) return errorJson("invalid_article_key", "Invalid article key.", 400);

  const result = await env.DB.prepare(
    `SELECT id, parent_id, display_name, body, is_author, created_at, status
       FROM comments
      WHERE article_key = ? AND status IN ('approved', 'withdrawn')
      ORDER BY created_at ASC, id ASC
      LIMIT ?`
  ).bind(articleKey, PUBLIC_COMMENT_LIMIT).all();

  const rows = result?.results || [];
  const visibleTopLevel = new Set(rows.filter(row => !row.parent_id).map(row => row.id));
  const visibleRows = rows.filter(row => !row.parent_id || visibleTopLevel.has(row.parent_id));
  return responseJson({ ok: true, comments: visibleRows.map(publicComment) });
}

async function submitComment(request, env) {
  if (!stateChangingRequestIsSameOrigin(request)) return errorJson("origin_rejected", "This request must come from HUIKAI.", 403);
  if (!(await rateLimitSubmission(request, env))) return errorJson("rate_limited", "Too many submissions. Please try again later.", 429, { "retry-after": "60" });

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    if (error.message === "REQUEST_TOO_LARGE") return errorJson("request_too_large", "Request is too large.", 413);
    return errorJson("invalid_json", "Invalid request body.", 400);
  }

  const articleKey = String(payload?.articleKey || "");
  const pagePath = String(payload?.pagePath || "");
  const displayName = normalizeName(payload?.displayName);
  const body = normalizeBody(payload?.body);
  const parentId = payload?.parentId ? String(payload.parentId) : null;

  if (!validArticleKey(articleKey)) return errorJson("invalid_article_key", "Invalid article key.");
  if (!validArticlePath(pagePath)) return errorJson("invalid_article_path", "Invalid article path.");
  if (!validDisplayName(displayName)) return errorJson("invalid_display_name", "Display name is invalid or reserved.");
  if (!validBody(body)) return errorJson("invalid_body", `Comment must be 1-${MAX_BODY_LENGTH} characters.`);
  if (parentId && !validCommentId(parentId)) return errorJson("invalid_parent", "Invalid reply target.");

  const turnstile = await verifyTurnstile(payload?.turnstileToken, env);
  if (!turnstile.ok) return errorJson("turnstile_failed", "Human verification failed.", 403);
  if (!(await publishedArticleAllowsComments(articleKey, pagePath))) return errorJson("article_not_eligible", "This article is not currently accepting comments.", 409);

  if (parentId) {
    const parent = await env.DB.prepare(
      `SELECT id, parent_id, status FROM comments WHERE id = ? AND article_key = ? LIMIT 1`
    ).bind(parentId, articleKey).first();
    if (!parent || parent.status !== "approved" || parent.parent_id) return errorJson("invalid_parent", "Replies are limited to approved top-level comments.", 409);
  }

  const id = crypto.randomUUID();
  const capabilityToken = newCapabilityToken();
  const capabilityHash = await sha256Hex(capabilityToken);
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO comments
      (id, article_key, parent_id, display_name, body, status, is_author, manage_token_hash, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).bind(id, articleKey, parentId, displayName, body, capabilityHash, createdAt).run();

  return responseJson({ ok: true, id, status: "pending", managementToken: capabilityToken }, 201);
}

async function withdrawComment(request, env, commentId) {
  if (!stateChangingRequestIsSameOrigin(request)) return errorJson("origin_rejected", "This request must come from HUIKAI.", 403);
  if (!validCommentId(commentId)) return errorJson("invalid_comment_id", "Invalid comment ID.");

  const token = request.headers.get("X-Comment-Manage-Token") || "";
  if (token.length < 32 || token.length > 256) return errorJson("invalid_management_token", "Invalid management token.", 403);
  const row = await env.DB.prepare(
    `SELECT id, status, manage_token_hash FROM comments WHERE id = ? LIMIT 1`
  ).bind(commentId).first();

  if (!row?.manage_token_hash) return errorJson("not_found", "Comment not found.", 404);
  const providedHash = await sha256Hex(token);
  if (!constantTimeEqual(providedHash, row.manage_token_hash)) return errorJson("invalid_management_token", "Invalid management token.", 403);
  if (!["pending", "approved"].includes(row.status)) return responseJson({ ok: true, status: row.status });

  if (row.status === "pending") {
    await env.DB.prepare(`DELETE FROM comments WHERE id = ?`).bind(commentId).run();
    return responseJson({ ok: true, status: "withdrawn" });
  }

  await env.DB.prepare(
    `UPDATE comments SET status = 'withdrawn', display_name = '', body = '', manage_token_hash = NULL, moderated_at = ? WHERE id = ?`
  ).bind(new Date().toISOString(), commentId).run();
  return responseJson({ ok: true, status: "withdrawn" });
}

function adminAuthorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix) || !env.COMMENTS_ADMIN_TOKEN) return false;
  return constantTimeEqual(header.slice(prefix.length), env.COMMENTS_ADMIN_TOKEN);
}

async function listPending(requestUrl, request, env) {
  if (!adminAuthorized(request, env)) return errorJson("unauthorized", "Unauthorized.", 401);
  const requested = Number(requestUrl.searchParams.get("limit") || 50);
  const limit = Math.min(ADMIN_PENDING_LIMIT, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 50));
  const result = await env.DB.prepare(
    `SELECT id, article_key, parent_id, display_name, body, created_at FROM comments WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
  ).bind(limit).all();
  return responseJson({ ok: true, comments: result?.results || [] });
}

async function moderateComment(request, env, commentId, nextStatus) {
  if (!adminAuthorized(request, env)) return errorJson("unauthorized", "Unauthorized.", 401);
  if (!validCommentId(commentId)) return errorJson("invalid_comment_id", "Invalid comment ID.");

  const row = await env.DB.prepare(
    `SELECT id, article_key, parent_id, status FROM comments WHERE id = ? LIMIT 1`
  ).bind(commentId).first();
  if (!row) return errorJson("not_found", "Comment not found.", 404);

  if (nextStatus === "approved" && row.parent_id) {
    const parent = await env.DB.prepare(
      `SELECT id, parent_id, status FROM comments WHERE id = ? AND article_key = ? LIMIT 1`
    ).bind(row.parent_id, row.article_key).first();
    if (!parent || parent.parent_id || parent.status !== "approved") return errorJson("invalid_parent", "Reply parent must be an approved top-level comment.", 409);
  }

  await env.DB.prepare(`UPDATE comments SET status = ?, moderated_at = ? WHERE id = ?`)
    .bind(nextStatus, new Date().toISOString(), commentId).run();
  return responseJson({ ok: true, id: commentId, status: nextStatus });
}

async function createAuthorReply(request, env) {
  if (!adminAuthorized(request, env)) return errorJson("unauthorized", "Unauthorized.", 401);

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    return errorJson("invalid_json", "Invalid request body.", 400);
  }
  const articleKey = String(payload?.articleKey || "");
  const parentId = String(payload?.parentId || "");
  const body = normalizeBody(payload?.body);

  if (!validArticleKey(articleKey)) return errorJson("invalid_article_key", "Invalid article key.");
  if (!validCommentId(parentId)) return errorJson("invalid_parent", "Invalid reply target.");
  if (!validBody(body)) return errorJson("invalid_body", `Comment must be 1-${MAX_BODY_LENGTH} characters.`);

  const parent = await env.DB.prepare(
    `SELECT id, parent_id, status FROM comments WHERE id = ? AND article_key = ? LIMIT 1`
  ).bind(parentId, articleKey).first();
  if (!parent || parent.parent_id || parent.status !== "approved") return errorJson("invalid_parent", "Author replies require an approved top-level comment.", 409);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO comments
      (id, article_key, parent_id, display_name, body, status, is_author, manage_token_hash, created_at, moderated_at)
     VALUES (?, ?, ?, 'HUIKAI', ?, 'approved', 1, NULL, ?, ?)`
  ).bind(id, articleKey, parentId, body, createdAt, createdAt).run();
  return responseJson({ ok: true, id, status: "approved" }, 201);
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(API_PREFIX)) return new Response("Not found", { status: 404 });

  if (request.method === "OPTIONS") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  if (url.pathname === `${API_PREFIX}/health` && request.method === "GET") return responseJson({ ok: true, service: "huikai-comments", version: 1, sourceSha: env.SOURCE_SHA || null });
  if (url.pathname === `${API_PREFIX}/comments` && request.method === "GET") return listPublicComments(url, env);
  if (url.pathname === `${API_PREFIX}/comments` && request.method === "POST") return submitComment(request, env);

  const withdrawMatch = url.pathname.match(new RegExp(`^${API_PREFIX}/comments/([0-9a-f-]+)/withdraw$`, "i"));
  if (withdrawMatch && request.method === "POST") return withdrawComment(request, env, withdrawMatch[1]);
  if (url.pathname === `${API_PREFIX}/admin/pending` && request.method === "GET") return listPending(url, request, env);

  const moderationMatch = url.pathname.match(new RegExp(`^${API_PREFIX}/admin/comments/([0-9a-f-]+)/(approve|hide)$`, "i"));
  if (moderationMatch && request.method === "POST") return moderateComment(request, env, moderationMatch[1], moderationMatch[2].toLowerCase() === "approve" ? "approved" : "hidden");
  if (url.pathname === `${API_PREFIX}/admin/replies` && request.method === "POST") return createAuthorReply(request, env);

  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export {
  adminAuthorized,
  normalizeBody,
  normalizeName,
  publishedArticleAllowsComments,
  reservedNameKey,
  sha256Hex,
  stateChangingRequestIsSameOrigin,
  validArticleKey,
  validArticlePath,
  validBody,
  validDisplayName,
};

export default { fetch: handleRequest };
