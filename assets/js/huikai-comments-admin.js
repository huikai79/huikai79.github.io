(() => {
  "use strict";

  const STATUS_LABELS = {
    pending: "待審核",
    approved: "已公開",
    hidden: "已隱藏",
  };

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
      error.code = payload.error || "request_failed";
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

  function setActiveStatus(root, state, nextStatus) {
    state.status = nextStatus;
    for (const button of root.querySelectorAll("[data-comments-admin-filter]")) {
      const active = button.dataset.commentsAdminFilter === nextStatus;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.dataset.active = active ? "true" : "false";
    }
    q(root, "[data-comments-admin-heading]").textContent = STATUS_LABELS[nextStatus] || nextStatus;
  }

  function contextName(displayName, status, removedByAdmin, isAuthor = false) {
    if (status === "withdrawn") return removedByAdmin ? "已移除的留言" : "已撤回的留言";
    if (displayName) return isAuthor ? `${displayName} · 作者` : displayName;
    return "目前不可見的留言";
  }

  function appendArticleContext(article, comment) {
    const context = make("div", "huikai-comments-admin__context");
    if (typeof comment.page_path === "string" && comment.page_path.startsWith("/") && comment.page_path.endsWith("/")) {
      const row = make("p", "huikai-comments-admin__article");
      row.append("文章：");
      const link = make("a", "", comment.page_path);
      link.href = comment.page_path;
      link.target = "_blank";
      link.rel = "noopener";
      row.append(link);
      context.append(row);
    } else {
      context.append(make("p", "huikai-comments-admin__article huikai-comments-admin__article--missing", "文章：舊留言未保存文章路徑"));
    }

    const threadLabel = comment.parent_id
      ? contextName(comment.root_display_name, comment.root_status, comment.root_removed_by_admin)
      : "頂層留言";
    context.append(make("p", "", `留言串：${threadLabel}`));

    if (comment.reply_to_id) {
      const replyLabel = contextName(comment.reply_to_display_name, comment.reply_to_status, comment.reply_to_removed_by_admin, Boolean(comment.reply_to_is_author));
      context.append(make("p", "", `正在回覆：${replyLabel}`));
    } else {
      context.append(make("p", "", "正在回覆：—"));
    }

    const key = make("code", "huikai-comments-admin__key", comment.article_key || "");
    context.append(key);
    article.append(context);
  }

  async function changeStatus(root, state, comment, action, button) {
    button.disabled = true;
    try {
      await request(root, state, `/admin/comments/${encodeURIComponent(comment.id)}/${action}`, { method: "POST", body: "{}" });
      const messages = {
        approve: "已通過留言。",
        hide: "已隱藏留言。",
        restore: "已恢復公開。",
      };
      setStatus(root, messages[action] || "留言狀態已更新。", "success");
      await load(root, state);
    } catch (error) {
      if (error.status === 401) clearAuth(root, state);
      else setStatus(root, "操作失敗，請重新整理後再試。", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function deleteComment(root, state, comment, button) {
    const confirmed = window.confirm("確定要刪除這則留言嗎？若已有後續回覆，系統會保留「這則回應已移除」的脈絡節點。此操作無法從管理頁恢復。");
    if (!confirmed) return;
    button.disabled = true;
    try {
      const payload = await request(root, state, `/admin/comments/${encodeURIComponent(comment.id)}/delete`, { method: "POST", body: "{}" });
      setStatus(root, payload.deleted === "tombstone" ? "留言內容已移除，對話脈絡已保留。" : "留言已永久刪除。", "success");
      await load(root, state);
    } catch (error) {
      if (error.status === 401) clearAuth(root, state);
      else setStatus(root, "刪除失敗，請重新整理後再試。", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function sendAuthorReply(root, state, comment, textarea, button, { approveFirst = false } = {}) {
    const body = textarea.value.trim();
    if (!body) { textarea.focus(); return; }
    button.disabled = true;
    let approved = false;
    try {
      if (approveFirst) {
        await request(root, state, `/admin/comments/${encodeURIComponent(comment.id)}/approve`, { method: "POST", body: "{}" });
        approved = true;
      }
      const replyPayload = { articleKey: comment.article_key, replyToId: comment.id, body };
      if (!Object.prototype.hasOwnProperty.call(comment, "reply_to_id")) replyPayload.parentId = comment.id;
      await request(root, state, "/admin/replies", {
        method: "POST",
        body: JSON.stringify(replyPayload),
      });
      textarea.value = "";
      setStatus(root, approveFirst ? "留言已通過，作者回覆也已發布。" : "作者回覆已發布。", "success");
      await load(root, state);
    } catch (error) {
      if (error.status === 401) clearAuth(root, state);
      else if (approveFirst && approved) setStatus(root, "留言已通過，但作者回覆未完成；請到「已公開」重新回覆。", "error");
      else setStatus(root, "作者回覆未完成，請重新整理後再試。", "error");
    } finally {
      button.disabled = false;
    }
  }

  function actionButton(text, className = "") {
    const button = make("button", `huikai-comments-admin__button${className ? ` ${className}` : ""}`, text);
    button.type = "button";
    return button;
  }

  function appendReplyComposer(root, state, article, comment, { approveFirst = false } = {}) {
    const replyWrap = make("div", "huikai-comments-admin__reply");
    const label = make("label", "huikai-comments-admin__field");
    label.append(make("span", "", approveFirst ? "作者回覆（選填）" : "作者回覆"));
    const textarea = make("textarea", "");
    textarea.rows = 4;
    textarea.maxLength = 4000;
    label.append(textarea);
    const reply = actionButton(approveFirst ? "通過並回覆" : "回覆");
    reply.addEventListener("click", () => sendAuthorReply(root, state, comment, textarea, reply, { approveFirst }));
    replyWrap.append(label, reply);
    article.append(replyWrap);
  }

  function render(root, state, comments) {
    const list = q(root, "[data-comments-admin-list]");
    list.replaceChildren();
    q(root, "[data-comments-admin-count]").textContent = String(comments.length);

    if (!comments.length) {
      const emptyText = state.status === "pending"
        ? "目前沒有待審核留言。"
        : state.status === "approved"
          ? "目前沒有已公開留言。"
          : "目前沒有已隱藏留言。";
      list.append(make("p", "huikai-comments-admin__empty", emptyText));
      return;
    }

    for (const comment of comments) {
      const article = make("article", "huikai-comments-admin__item");
      article.dataset.commentId = comment.id;

      const meta = make("div", "huikai-comments-admin__meta");
      const identity = make("strong", "", comment.display_name || (comment.is_author ? "HUIKAI" : "讀者"));
      if (comment.is_author) identity.append(" · 作者");
      meta.append(identity);
      meta.append(make("span", "", humanDate(comment.created_at)));
      article.append(meta);

      appendArticleContext(article, comment);

      const body = make("div", "huikai-comments-admin__body");
      body.textContent = comment.body || "";
      article.append(body);

      const actions = make("div", "huikai-comments-admin__actions");
      if (state.status === "pending") {
        const approve = actionButton("通過");
        approve.addEventListener("click", () => changeStatus(root, state, comment, "approve", approve));
        const hide = actionButton("隱藏", "huikai-comments-admin__button--muted");
        hide.addEventListener("click", () => changeStatus(root, state, comment, "hide", hide));
        const remove = actionButton("刪除", "huikai-comments-admin__button--danger");
        remove.addEventListener("click", () => deleteComment(root, state, comment, remove));
        actions.append(approve, hide, remove);
        article.append(actions);
        appendReplyComposer(root, state, article, comment, { approveFirst: true });
      } else if (state.status === "approved") {
        const hide = actionButton("隱藏", "huikai-comments-admin__button--muted");
        hide.addEventListener("click", () => changeStatus(root, state, comment, "hide", hide));
        const remove = actionButton("刪除", "huikai-comments-admin__button--danger");
        remove.addEventListener("click", () => deleteComment(root, state, comment, remove));
        actions.append(hide, remove);
        article.append(actions);
        appendReplyComposer(root, state, article, comment);
      } else if (state.status === "hidden") {
        const restore = actionButton("恢復公開");
        restore.addEventListener("click", () => changeStatus(root, state, comment, "restore", restore));
        const remove = actionButton("永久刪除", "huikai-comments-admin__button--danger");
        remove.addEventListener("click", () => deleteComment(root, state, comment, remove));
        actions.append(restore, remove);
        article.append(actions);
      }

      list.append(article);
    }
  }

  async function load(root, state) {
    const panel = q(root, "[data-comments-admin-panel]");
    panel.setAttribute("aria-busy", "true");
    try {
      let payload;
      try {
        payload = await request(root, state, `/admin/comments?status=${encodeURIComponent(state.status)}&limit=100`, { method: "GET", headers: {} });
      } catch (error) {
        if (state.status !== "pending" || error.status !== 404) throw error;
        payload = await request(root, state, "/admin/pending?limit=100", { method: "GET", headers: {} });
      }
      render(root, state, Array.isArray(payload.comments) ? payload.comments : []);
      q(root, "[data-comments-admin-login]").hidden = true;
      panel.hidden = false;
      setStatus(root, `${STATUS_LABELS[state.status]}留言已載入。`, "success");
      return true;
    } catch (error) {
      if (error.status === 401) {
        state.token = "";
        setStatus(root, "管理密碼不正確。", "error");
      } else {
        setStatus(root, "無法載入留言，請稍後再試。", "error");
      }
      return false;
    } finally {
      panel.removeAttribute("aria-busy");
    }
  }

  function init(root) {
    const state = { token: "", status: "pending" };
    const form = q(root, "[data-comments-admin-login]");
    const tokenInput = q(root, "[data-comments-admin-token]");
    setActiveStatus(root, state, state.status);

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      state.token = tokenInput.value;
      const ok = await load(root, state);
      if (ok) tokenInput.value = "";
    });

    for (const button of root.querySelectorAll("[data-comments-admin-filter]")) {
      button.addEventListener("click", async () => {
        const nextStatus = button.dataset.commentsAdminFilter;
        if (!STATUS_LABELS[nextStatus] || nextStatus === state.status) return;
        setActiveStatus(root, state, nextStatus);
        await load(root, state);
      });
    }

    q(root, "[data-comments-admin-refresh]").addEventListener("click", () => load(root, state));
    q(root, "[data-comments-admin-logout]").addEventListener("click", () => clearAuth(root, state));
  }

  const start = () => document.querySelectorAll(".huikai-comments-admin").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
