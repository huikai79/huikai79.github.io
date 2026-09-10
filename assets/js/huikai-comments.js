(() => {
  "use strict";

  const STORAGE_KEY = "huikai-comment-capabilities-v1";
  const q = (root, selector) => root.querySelector(selector);
  const make = (tag, className, text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  };

  function readCaps() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  function writeCaps(value) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {} }
  function saveCap(id, token) { const caps = readCaps(); caps[id] = token; writeCaps(caps); }
  function removeCap(id) { const caps = readCaps(); delete caps[id]; writeCaps(caps); }
  function label(root, key, fallback) { return root.dataset[key] || fallback; }
  function status(root, text, kind = "") { const el = q(root, "[data-comments-status]"); if (el) { el.textContent = text; el.dataset.kind = kind; } }
  function api(root) { return root.dataset.apiBase.replace(/\/$/, ""); }

  async function json(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.message || `HTTP ${response.status}`); error.code = payload.error || "request_failed"; throw error; }
    return payload;
  }

  function date(value, language) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    try { return new Intl.DateTimeFormat(language || "zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed); }
    catch { return parsed.toISOString().slice(0, 10); }
  }

  function clearReply(root) {
    q(root, "[data-comments-parent]").value = "";
    q(root, "[data-comments-reply-name]").textContent = "";
    q(root, "[data-comments-reply-state]").hidden = true;
  }

  function chooseReply(root, comment) {
    q(root, "[data-comments-parent]").value = comment.id;
    q(root, "[data-comments-reply-name]").textContent = comment.displayName || label(root, "withdrawnLabel", "已撤回");
    q(root, "[data-comments-reply-state]").hidden = false;
    q(root, "[data-comments-body]").focus();
  }

  async function withdraw(root, commentId, button) {
    const token = readCaps()[commentId];
    if (!token) return;
    button.disabled = true;
    try {
      await json(`${api(root)}/comments/${encodeURIComponent(commentId)}/withdraw`, { method: "POST", headers: { "X-Comment-Manage-Token": token }, body: "{}" });
      removeCap(commentId);
      status(root, label(root, "withdrawSuccess", "這則回應已撤回。"), "success");
      await load(root);
    } catch {
      status(root, label(root, "submitError", "暫時無法撤回，請稍後再試。"), "error");
      button.disabled = false;
    }
  }

  function renderOne(root, comment, topById) {
    const item = make("article", `huikai-comment${comment.parentId ? " huikai-comment--reply" : ""}${comment.isAuthor ? " huikai-comment--author" : ""}${comment.withdrawn ? " huikai-comment--withdrawn" : ""}`);
    item.dataset.commentId = comment.id;
    const header = make("header", "huikai-comment__meta");
    const identity = make("span", "huikai-comment__identity", comment.withdrawn ? label(root, "withdrawnLabel", "這則回應已撤回") : (comment.displayName || "讀者"));
    if (comment.isAuthor && !comment.withdrawn) identity.append(" · ", make("span", "huikai-comment__author-label", label(root, "authorLabel", "作者")));
    header.append(identity);
    const when = date(comment.createdAt, root.dataset.language);
    if (when) header.append(make("time", "huikai-comment__date", when));
    item.append(header);
    if (comment.parentId && topById.has(comment.parentId)) item.append(make("div", "huikai-comment__reply-context", `${label(root, "replyLabel", "回覆")} ${topById.get(comment.parentId).displayName || label(root, "withdrawnLabel", "已撤回")}`));
    if (!comment.withdrawn) {
      const body = make("div", "huikai-comment__body");
      body.textContent = comment.body || "";
      item.append(body);
      const actions = make("div", "huikai-comment__actions");
      if (!comment.parentId) { const reply = make("button", "huikai-comment__action", label(root, "replyLabel", "回覆")); reply.type = "button"; reply.addEventListener("click", () => chooseReply(root, comment)); actions.append(reply); }
      if (readCaps()[comment.id]) { const button = make("button", "huikai-comment__action", label(root, "withdrawLabel", "撤回")); button.type = "button"; button.addEventListener("click", () => withdraw(root, comment.id, button)); actions.append(button); }
      if (actions.childElementCount) item.append(actions);
    }
    return item;
  }

  function render(root, comments) {
    const list = q(root, "[data-comments-list]");
    const empty = q(root, "[data-comments-empty-summary]");
    list.replaceChildren();
    if (empty) empty.hidden = comments.length !== 0;
    if (!comments.length) return;
    const top = comments.filter(item => !item.parentId);
    const topById = new Map(top.map(item => [item.id, item]));
    const replies = new Map();
    for (const item of comments) if (item.parentId) { const values = replies.get(item.parentId) || []; values.push(item); replies.set(item.parentId, values); }
    for (const item of top) {
      const group = make("div", "huikai-comment-group");
      group.append(renderOne(root, item, topById));
      for (const reply of replies.get(item.id) || []) group.append(renderOne(root, reply, topById));
      list.append(group);
    }
  }

  async function load(root) {
    const list = q(root, "[data-comments-list]");
    const empty = q(root, "[data-comments-empty-summary]");
    list.setAttribute("aria-busy", "true");
    try {
      const payload = await json(`${api(root)}/comments?articleKey=${encodeURIComponent(root.dataset.commentKey)}`, { method: "GET", headers: {} });
      render(root, Array.isArray(payload.comments) ? payload.comments : []);
    } catch {
      list.replaceChildren();
      if (empty) empty.hidden = true;
      status(root, label(root, "loadError", "暫時無法載入回應，請稍後再試。"), "error");
    }
    finally { list.removeAttribute("aria-busy"); }
  }

  async function turnstile(root, state) {
    for (let i = 0; i < 80 && !window.turnstile?.render; i += 1) await new Promise(resolve => setTimeout(resolve, 50));
    if (!window.turnstile?.render) { status(root, label(root, "verificationRequired", "人機驗證暫時無法載入。"), "error"); return; }
    const target = q(root, "[data-comments-turnstile]");
    state.widgetId = window.turnstile.render(target, {
      sitekey: root.dataset.turnstileSiteKey,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      size: "flexible",
      appearance: "interaction-only",
      action: "comment-submit",
      callback(token) { state.token = token || ""; if (state.token) status(root, ""); },
      "expired-callback"() { state.token = ""; },
      "error-callback"() { state.token = ""; status(root, label(root, "verificationRequired", "請重新完成人機驗證。"), "error"); },
    });
  }

  function form(root, state) {
    const form = q(root, "[data-comments-form]");
    q(root, "[data-comments-cancel-reply]").addEventListener("click", () => clearReply(root));
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (!state.token) { status(root, label(root, "verificationRequired", "請先完成人機驗證。"), "error"); return; }
      const submit = q(root, "[data-comments-submit]"); submit.disabled = true;
      try {
        const payload = await json(`${api(root)}/comments`, { method: "POST", body: JSON.stringify({ articleKey: root.dataset.commentKey, pagePath: root.dataset.pagePath || location.pathname, displayName: q(root, "[data-comments-name]").value, body: q(root, "[data-comments-body]").value, parentId: q(root, "[data-comments-parent]").value || null, turnstileToken: state.token }) });
        if (payload.id && payload.managementToken) saveCap(payload.id, payload.managementToken);
        q(root, "[data-comments-body]").value = ""; clearReply(root); status(root, label(root, "submitSuccess", "回應已收到，公開前會先經過簡單審核。"), "success");
      } catch (error) {
        status(root, error.code === "rate_limited" ? label(root, "rateLimitError", "送出得太頻繁，請稍後再試。") : label(root, "submitError", "暫時無法送出回應，請稍後再試。"), "error");
      } finally {
        state.token = ""; try { window.turnstile?.reset(state.widgetId); } catch {} submit.disabled = false;
      }
    });
  }

  async function init(root) {
    if (root.dataset.initialized) return;
    root.dataset.initialized = "true";
    const state = { token: "", widgetId: null };
    form(root, state);
    await Promise.all([load(root), turnstile(root, state)]);
  }

  const start = () => document.querySelectorAll(".huikai-comments").forEach(root => init(root).catch(() => status(root, label(root, "loadError", "留言功能暫時無法使用。"), "error")));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
