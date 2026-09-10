(() => {
  "use strict";

  const q = (root, selector) => root.querySelector(selector);
  const make = (tag, className, text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  };

  function setStatus(root, text, kind = "") {
    const node = q(root, "[data-comments-admin-status]");
    node.textContent = text;
    node.dataset.kind = kind;
  }

  async function request(root, state, path, options = {}) {
    if (!state.token) throw new Error("NOT_AUTHENTICATED");
    const response = await fetch(`${root.dataset.apiBase.replace(/\/$/, "")}${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${state.token}`,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function humanDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    try { return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(date); }
    catch { return date.toISOString(); }
  }

  function clearAuth(root, state) {
    state.token = "";
    q(root, "[data-comments-admin-token]").value = "";
    q(root, "[data-comments-admin-login]").hidden = false;
    q(root, "[data-comments-admin-panel]").hidden = true;
    q(root, "[data-comments-admin-list]").replaceChildren();
    setStatus(root, "已登出。", "");
  }

  async function act(root, state, comment, action, button) {
    button.disabled = true;
    try {
      await request(root, state, `/admin/comments/${encodeURIComponent(comment.id)}/${action}`, { method: "POST", body: "{}" });
      setStatus(root, action === "approve" ? "已通過留言。" : "已隱藏留言。", "success");
      await load(root, state);
    } catch (error) {
      if (error.status === 401) clearAuth(root, state);
      else setStatus(root, "操作失敗，請稍後再試。", "error");
    } finally { button.disabled = false; }
  }

  async function approveAndReply(root, state, comment, textarea, button) {
    const body = textarea.value.trim();
    if (!body) { textarea.focus(); return; }
    button.disabled = true;
    try {
      await request(root, state, `/admin/comments/${encodeURIComponent(comment.id)}/approve`, { method: "POST", body: "{}" });
      await request(root, state, "/admin/replies", {
        method: "POST",
        body: JSON.stringify({ articleKey: comment.article_key, parentId: comment.id, body }),
      });
      setStatus(root, "留言已通過，作者回覆也已發布。", "success");
      await load(root, state);
    } catch (error) {
      if (error.status === 401) clearAuth(root, state);
      else setStatus(root, "留言可能已通過，但作者回覆未完成；請重新整理後確認。", "error");
    } finally { button.disabled = false; }
  }

  function render(root, state, comments) {
    const list = q(root, "[data-comments-admin-list]");
    list.replaceChildren();
    q(root, "[data-comments-admin-count]").textContent = String(comments.length);
    if (!comments.length) {
      list.append(make("p", "huikai-comments-admin__empty", "目前沒有待審核留言。"));
      return;
    }

    for (const comment of comments) {
      const article = make("article", "huikai-comments-admin__item");
      const meta = make("div", "huikai-comments-admin__meta");
      meta.append(make("strong", "", comment.display_name || "讀者"));
      meta.append(make("span", "", humanDate(comment.created_at)));
      article.append(meta);

      const key = make("code", "huikai-comments-admin__key", comment.article_key || "");
      article.append(key);
      if (comment.parent_id) article.append(make("p", "huikai-comments-admin__reply-note", `回覆留言：${comment.parent_id}`));

      const body = make("div", "huikai-comments-admin__body");
      body.textContent = comment.body || "";
      article.append(body);

      const actions = make("div", "huikai-comments-admin__actions");
      const approve = make("button", "huikai-comments-admin__button", "通過");
      approve.type = "button";
      approve.addEventListener("click", () => act(root, state, comment, "approve", approve));
      const hide = make("button", "huikai-comments-admin__button huikai-comments-admin__button--muted", "隱藏");
      hide.type = "button";
      hide.addEventListener("click", () => act(root, state, comment, "hide", hide));
      actions.append(approve, hide);
      article.append(actions);

      if (!comment.parent_id) {
        const replyWrap = make("div", "huikai-comments-admin__reply");
        const label = make("label", "huikai-comments-admin__field");
        label.append(make("span", "", "作者回覆（選填）"));
        const textarea = make("textarea", "");
        textarea.rows = 4;
        textarea.maxLength = 4000;
        label.append(textarea);
        const approveReply = make("button", "huikai-comments-admin__button", "通過並回覆");
        approveReply.type = "button";
        approveReply.addEventListener("click", () => approveAndReply(root, state, comment, textarea, approveReply));
        replyWrap.append(label, approveReply);
        article.append(replyWrap);
      }
      list.append(article);
    }
  }

  async function load(root, state) {
    const panel = q(root, "[data-comments-admin-panel]");
    panel.setAttribute("aria-busy", "true");
    try {
      const payload = await request(root, state, "/admin/pending?limit=100", { method: "GET", headers: {} });
      render(root, state, Array.isArray(payload.comments) ? payload.comments : []);
      q(root, "[data-comments-admin-login]").hidden = true;
      panel.hidden = false;
      setStatus(root, "待審核留言已載入。", "success");
      return true;
    } catch (error) {
      if (error.status === 401) {
        state.token = "";
        setStatus(root, "管理密碼不正確。", "error");
      } else setStatus(root, "無法載入待審核留言。", "error");
      return false;
    } finally { panel.removeAttribute("aria-busy"); }
  }

  function init(root) {
    const state = { token: "" };
    const form = q(root, "[data-comments-admin-login]");
    const tokenInput = q(root, "[data-comments-admin-token]");
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      state.token = tokenInput.value;
      const ok = await load(root, state);
      if (ok) tokenInput.value = "";
    });
    q(root, "[data-comments-admin-refresh]").addEventListener("click", () => load(root, state));
    q(root, "[data-comments-admin-logout]").addEventListener("click", () => clearAuth(root, state));
  }

  const start = () => document.querySelectorAll(".huikai-comments-admin").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
