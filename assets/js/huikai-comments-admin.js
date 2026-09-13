(() => {
  "use strict";

  const STATUS_LABELS = {
    pending: "待審核",
    approved: "已公開",
    hidden: "已隱藏",
  };
  const FLAT_PAGE_SIZE = 25;
  const ARTICLE_PAGE_SIZE = 20;
  const ARTICLE_FETCH_SIZE = 100;

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

  function parseManifest(root) {
    const script = q(root, "[data-comments-admin-article-manifest]");
    if (!script) return new Map();
    try {
      const rows = JSON.parse(script.textContent || "[]");
      const map = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || typeof row.articleKey !== "string") continue;
        const variants = map.get(row.articleKey) || [];
        variants.push({
          articleKey: row.articleKey,
          title: typeof row.title === "string" ? row.title : "",
          path: typeof row.path === "string" ? row.path : "",
          language: typeof row.language === "string" ? row.language : "",
        });
        map.set(row.articleKey, variants);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  function clearAuth(root, state) {
    state.token = "";
    state.articleKey = "";
    state.view = "list";
    state.flatOffset = 0;
    state.articleOffset = 0;
    state.search = "";
    state.searchResults = null;
    q(root, "[data-comments-admin-token]").value = "";
    q(root, "[data-comments-admin-login]").hidden = false;
    q(root, "[data-comments-admin-panel]").hidden = true;
    q(root, "[data-comments-admin-list]").replaceChildren();
    setStatus(root, "已登出。", "");
  }

  function setToolsVisibility(root, state) {
    const publishedTools = q(root, "[data-comments-admin-published-tools]");
    const detailHeader = q(root, "[data-comments-admin-detail-header]");
    if (publishedTools) publishedTools.hidden = !(state.status === "approved" && state.view === "list" && state.publishedV3 !== false);
    if (detailHeader) detailHeader.hidden = !(state.status === "approved" && state.view === "detail");
  }

  function setActiveStatus(root, state, nextStatus) {
    state.status = nextStatus;
    state.view = "list";
    state.articleKey = "";
    state.flatOffset = 0;
    state.articleOffset = 0;
    state.search = "";
    state.searchResults = null;
    const searchInput = q(root, "[data-comments-admin-search]");
    if (searchInput) searchInput.value = "";
    for (const button of root.querySelectorAll("[data-comments-admin-filter]")) {
      const active = button.dataset.commentsAdminFilter === nextStatus;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.dataset.active = active ? "true" : "false";
    }
    q(root, "[data-comments-admin-heading]").textContent = STATUS_LABELS[nextStatus] || nextStatus;
    setToolsVisibility(root, state);
  }

  function contextName(displayName, status, removedByAdmin, isAuthor = false) {
    if (status === "withdrawn") return removedByAdmin ? "已移除的留言" : "已撤回的留言";
    if (displayName) return isAuthor ? `${displayName} · 作者` : displayName;
    return "目前不可見的留言";
  }

  function articleVariants(state, articleKey) {
    return state.manifest.get(articleKey) || [];
  }

  function articlePresentation(state, articleKey, pagePath = "") {
    const variants = articleVariants(state, articleKey);
    const exact = pagePath ? variants.find(item => item.path === pagePath) : null;
    if (exact) return { primary: exact, variants, ambiguous: false };
    if (variants.length === 1) return { primary: variants[0], variants, ambiguous: false };
    return { primary: null, variants, ambiguous: variants.length > 1 };
  }

  function appendVariantLinks(container, variants) {
    if (!variants.length) return;
    const list = make("div", "huikai-comments-admin__variants");
    for (const variant of variants) {
      if (!variant.path) continue;
      const link = make("a", "", `${variant.language || "版本"}：${variant.title || variant.path}`);
      link.href = variant.path;
      link.target = "_blank";
      link.rel = "noopener";
      list.append(link);
    }
    if (list.childNodes.length) container.append(list);
  }

  function appendArticleContext(article, state, comment) {
    const context = make("div", "huikai-comments-admin__context");
    const presentation = articlePresentation(state, comment.article_key || "", comment.page_path || "");
    const row = make("p", "huikai-comments-admin__article");
    row.append("文章：");
    if (presentation.primary?.path) {
      const link = make("a", "", presentation.primary.title || presentation.primary.path);
      link.href = presentation.primary.path;
      link.target = "_blank";
      link.rel = "noopener";
      row.append(link);
    } else if (presentation.ambiguous) {
      row.append(`多語文章（${presentation.variants.length} 個版本）`);
    } else if (typeof comment.page_path === "string" && comment.page_path.startsWith("/")) {
      const link = make("a", "", comment.page_path);
      link.href = comment.page_path;
      link.target = "_blank";
      link.rel = "noopener";
      row.append(link);
    } else {
      row.append("文章目前不在公開索引");
      row.classList.add("huikai-comments-admin__article--missing");
    }
    context.append(row);
    if (presentation.ambiguous) appendVariantLinks(context, presentation.variants);

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

    if (comment.effective_visible === 0 && comment.status === "approved") {
      context.append(make("p", "huikai-comments-admin__visibility-note", "資料狀態為已公開，但因根留言目前不可見，讀者端實際不會顯示。"));
    }

    const key = make("code", "huikai-comments-admin__key", comment.article_key || "");
    context.append(key);
    article.append(context);
  }

  async function changeStatus(root, state, comment, action, button) {
    button.disabled = true;
    try {
      await request(root, state, `/admin/comments/${encodeURIComponent(comment.id)}/${action}`, { method: "POST", body: "{}" });
      const messages = { approve: "已通過留言。", hide: "已隱藏留言。", restore: "已恢復公開。" };
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
      await request(root, state, "/admin/replies", { method: "POST", body: JSON.stringify(replyPayload) });
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

  function appendLifecycleActions(root, state, article, comment, { approveFirst = false } = {}) {
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
      return;
    }
    if (state.status === "approved" && comment.status === "approved") {
      const hide = actionButton("隱藏", "huikai-comments-admin__button--muted");
      hide.addEventListener("click", () => changeStatus(root, state, comment, "hide", hide));
      const remove = actionButton("刪除", "huikai-comments-admin__button--danger");
      remove.addEventListener("click", () => deleteComment(root, state, comment, remove));
      actions.append(hide, remove);
      article.append(actions);
      appendReplyComposer(root, state, article, comment, { approveFirst });
      return;
    }
    if (state.status === "hidden") {
      const restore = actionButton("恢復公開");
      restore.addEventListener("click", () => changeStatus(root, state, comment, "restore", restore));
      const remove = actionButton("永久刪除", "huikai-comments-admin__button--danger");
      remove.addEventListener("click", () => deleteComment(root, state, comment, remove));
      actions.append(restore, remove);
      article.append(actions);
    }
  }

  function renderFlat(root, state, comments, payload) {
    const list = q(root, "[data-comments-admin-list]");
    list.replaceChildren();
    q(root, "[data-comments-admin-count]").textContent = String(payload.total ?? comments.length);

    if (!comments.length) {
      const emptyText = state.status === "pending" ? "目前沒有待審核留言。" : state.status === "approved" ? "目前沒有已公開留言。" : "目前沒有已隱藏留言。";
      list.append(make("p", "huikai-comments-admin__empty", emptyText));
      renderPagination(root, state, payload, "flat");
      return;
    }

    for (const comment of comments) {
      const article = make("article", "huikai-comments-admin__item");
      article.dataset.commentId = comment.id;
      const meta = make("div", "huikai-comments-admin__meta");
      const identity = make("strong", "", comment.display_name || (comment.is_author ? "HUIKAI" : "讀者"));
      if (comment.is_author) identity.append(" · 作者");
      meta.append(identity, make("span", "", humanDate(comment.created_at)));
      article.append(meta);
      appendArticleContext(article, state, comment);
      const body = make("div", "huikai-comments-admin__body");
      body.textContent = comment.body || "";
      article.append(body);
      appendLifecycleActions(root, state, article, comment);
      list.append(article);
    }
    renderPagination(root, state, payload, "flat");
  }

  function articleMatches(state, article, query) {
    const needle = query.trim().toLocaleLowerCase("zh-TW");
    if (!needle) return true;
    const variants = articleVariants(state, article.article_key || "");
    const haystack = [article.article_key, article.page_path, ...variants.flatMap(item => [item.title, item.path, item.language])]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase("zh-TW");
    return haystack.includes(needle);
  }

  function renderArticleCard(root, state, article) {
    const card = make("article", "huikai-comments-admin__article-card");
    const presentation = articlePresentation(state, article.article_key || "", article.page_path || "");
    const title = make("h4", "huikai-comments-admin__article-title");
    if (presentation.primary?.path) {
      const link = make("a", "", presentation.primary.title || presentation.primary.path);
      link.href = presentation.primary.path;
      link.target = "_blank";
      link.rel = "noopener";
      title.append(link);
    } else if (presentation.ambiguous) {
      title.textContent = `多語文章（${presentation.variants.length} 個版本）`;
    } else {
      title.textContent = "文章目前不在公開索引";
      title.classList.add("huikai-comments-admin__article-title--missing");
    }
    card.append(title);
    if (presentation.ambiguous) appendVariantLinks(card, presentation.variants);
    else if (!presentation.primary && article.page_path) {
      const pathLink = make("a", "huikai-comments-admin__path", article.page_path);
      pathLink.href = article.page_path;
      pathLink.target = "_blank";
      pathLink.rel = "noopener";
      card.append(pathLink);
    }

    const summary = make("div", "huikai-comments-admin__article-summary");
    summary.append(make("span", "", `${Number(article.comment_count || 0)} 個公開節點`));
    summary.append(make("span", "", `${Number(article.thread_count || 0)} 個討論串`));
    summary.append(make("span", "", `最近回應 ${humanDate(article.latest_at)}`));
    card.append(summary);
    card.append(make("code", "huikai-comments-admin__key", article.article_key || ""));

    const actions = make("div", "huikai-comments-admin__actions");
    const manage = actionButton("管理討論");
    manage.addEventListener("click", async () => {
      state.view = "detail";
      state.articleKey = article.article_key || "";
      state.currentArticle = article;
      setToolsVisibility(root, state);
      await load(root, state);
    });
    actions.append(manage);
    card.append(actions);
    return card;
  }

  function renderArticles(root, state, articles, payload) {
    const list = q(root, "[data-comments-admin-list]");
    list.replaceChildren();
    q(root, "[data-comments-admin-heading]").textContent = state.search ? "已公開 · 搜尋" : "已公開文章";
    q(root, "[data-comments-admin-count]").textContent = String(payload.total ?? articles.length);
    if (!articles.length) {
      list.append(make("p", "huikai-comments-admin__empty", state.search ? "沒有符合搜尋條件的文章。" : "目前沒有已公開討論。"));
    } else {
      for (const article of articles) list.append(renderArticleCard(root, state, article));
    }
    renderPagination(root, state, payload, "articles");
  }

  function conversationLabel(comment) {
    if (comment.status === "withdrawn") return comment.removed_by_admin ? "這則回應已移除" : "這則回應已撤回";
    if (comment.display_name) return comment.is_author ? `${comment.display_name} · 作者` : comment.display_name;
    return comment.is_author ? "HUIKAI · 作者" : "讀者";
  }

  function renderConversationComment(root, state, comment, byId, { reply = false } = {}) {
    const item = make("article", `huikai-comments-admin__conversation-comment${reply ? " huikai-comments-admin__conversation-comment--reply" : ""}`);
    item.dataset.commentId = comment.id;
    const meta = make("div", "huikai-comments-admin__meta");
    meta.append(make("strong", "", conversationLabel(comment)), make("span", "", humanDate(comment.created_at)));
    item.append(meta);

    if (reply && comment.reply_to_id) {
      const target = byId.get(comment.reply_to_id);
      const targetName = target ? conversationLabel(target) : contextName(comment.reply_to_display_name, comment.reply_to_status, comment.reply_to_removed_by_admin, Boolean(comment.reply_to_is_author));
      item.append(make("p", "huikai-comments-admin__reply-context", `回覆 ${targetName}`));
    }

    const body = make("div", `huikai-comments-admin__body${comment.status === "withdrawn" ? " huikai-comments-admin__body--tombstone" : ""}`);
    body.textContent = comment.status === "withdrawn"
      ? (comment.removed_by_admin ? "這則回應已移除。" : "這則回應已由原留言者撤回。")
      : (comment.body || "");
    item.append(body);

    if (comment.status === "approved") appendLifecycleActions(root, state, item, comment);
    return item;
  }

  function renderConversation(root, state, comments) {
    const list = q(root, "[data-comments-admin-list]");
    list.replaceChildren();
    q(root, "[data-comments-admin-heading]").textContent = "文章討論";
    q(root, "[data-comments-admin-count]").textContent = String(comments.length);
    const byId = new Map(comments.map(comment => [comment.id, comment]));
    const roots = comments.filter(comment => !comment.parent_id);
    const children = new Map();
    for (const comment of comments) {
      if (!comment.parent_id) continue;
      const rows = children.get(comment.parent_id) || [];
      rows.push(comment);
      children.set(comment.parent_id, rows);
    }

    if (!roots.length) {
      list.append(make("p", "huikai-comments-admin__empty", "這篇文章目前沒有可見的公開討論。"));
      return;
    }

    for (const rootComment of roots) {
      const thread = make("section", "huikai-comments-admin__thread");
      thread.append(renderConversationComment(root, state, rootComment, byId));
      const replies = children.get(rootComment.id) || [];
      if (replies.length) {
        const replyList = make("div", "huikai-comments-admin__thread-replies");
        for (const reply of replies) replyList.append(renderConversationComment(root, state, reply, byId, { reply: true }));
        thread.append(replyList);
      }
      list.append(thread);
    }
  }

  function updateDetailHeader(root, state, article) {
    const titleNode = q(root, "[data-comments-admin-detail-title]");
    const linksNode = q(root, "[data-comments-admin-detail-links]");
    if (!titleNode || !linksNode) return;
    linksNode.replaceChildren();
    const presentation = articlePresentation(state, state.articleKey, article?.page_path || "");
    if (presentation.primary) titleNode.textContent = presentation.primary.title || presentation.primary.path || "文章討論";
    else if (presentation.ambiguous) titleNode.textContent = `多語文章（${presentation.variants.length} 個版本）`;
    else titleNode.textContent = "文章目前不在公開索引";
    if (presentation.variants.length) appendVariantLinks(linksNode, presentation.variants);
    else if (article?.page_path) {
      const link = make("a", "", article.page_path);
      link.href = article.page_path;
      link.target = "_blank";
      link.rel = "noopener";
      linksNode.append(link);
    }
    linksNode.append(make("code", "huikai-comments-admin__key", state.articleKey));
  }

  function renderPagination(root, state, payload, mode) {
    const nav = q(root, "[data-comments-admin-pagination]");
    const prev = q(root, "[data-comments-admin-prev]");
    const next = q(root, "[data-comments-admin-next]");
    const label = q(root, "[data-comments-admin-page-label]");
    if (!nav || !prev || !next || !label) return;
    if (state.view === "detail") {
      nav.hidden = true;
      return;
    }
    const total = Number(payload.total || 0);
    const limit = Number(payload.limit || (mode === "articles" ? ARTICLE_PAGE_SIZE : FLAT_PAGE_SIZE));
    const offset = Number(payload.offset || 0);
    nav.hidden = total <= limit && offset === 0;
    prev.disabled = offset <= 0;
    next.disabled = !payload.hasMore;
    prev.dataset.paginationMode = mode;
    next.dataset.paginationMode = mode;
    if (!total) label.textContent = "0 / 0";
    else label.textContent = `${offset + 1}–${Math.min(offset + limit, total)} / ${total}`;
  }

  async function fetchAllArticleSummaries(root, state) {
    const all = [];
    let offset = 0;
    while (true) {
      const payload = await request(root, state, `/admin/articles?status=approved&limit=${ARTICLE_FETCH_SIZE}&offset=${offset}`, { method: "GET", headers: {} });
      const rows = Array.isArray(payload.articles) ? payload.articles : [];
      all.push(...rows);
      if (!payload.hasMore || !rows.length) break;
      offset += rows.length;
      if (offset > 10000) throw new Error("ARTICLE_SEARCH_LIMIT");
    }
    return all;
  }

  async function loadPublishedArticles(root, state) {
    let payload;
    if (state.search) {
      if (!state.searchResults) {
        const all = await fetchAllArticleSummaries(root, state);
        state.searchResults = all.filter(article => articleMatches(state, article, state.search));
      }
      const rows = state.searchResults.slice(state.articleOffset, state.articleOffset + ARTICLE_PAGE_SIZE);
      payload = {
        articles: rows,
        total: state.searchResults.length,
        limit: ARTICLE_PAGE_SIZE,
        offset: state.articleOffset,
        hasMore: state.articleOffset + rows.length < state.searchResults.length,
      };
    } else {
      payload = await request(root, state, `/admin/articles?status=approved&limit=${ARTICLE_PAGE_SIZE}&offset=${state.articleOffset}`, { method: "GET", headers: {} });
    }
    state.publishedV3 = true;
    setToolsVisibility(root, state);
    renderArticles(root, state, Array.isArray(payload.articles) ? payload.articles : [], payload);
  }

  async function loadArticleConversation(root, state) {
    const comments = [];
    let offset = 0;
    let total = 0;
    while (true) {
      const payload = await request(root, state, `/admin/comments?status=approved&articleKey=${encodeURIComponent(state.articleKey)}&limit=${ARTICLE_FETCH_SIZE}&offset=${offset}`, { method: "GET", headers: {} });
      const rows = Array.isArray(payload.comments) ? payload.comments : [];
      comments.push(...rows);
      total = Number(payload.total || comments.length);
      if (!payload.hasMore || !rows.length) break;
      offset += rows.length;
      if (offset > 10000) throw new Error("ARTICLE_CONVERSATION_LIMIT");
    }
    updateDetailHeader(root, state, state.currentArticle || { article_key: state.articleKey });
    renderConversation(root, state, comments);
    const nav = q(root, "[data-comments-admin-pagination]");
    if (nav) nav.hidden = true;
    setStatus(root, `文章討論已載入，共 ${total} 個目前可見的公開留言／脈絡節點。`, "success");
  }

  async function loadFlat(root, state) {
    const path = `/admin/comments?status=${encodeURIComponent(state.status)}&limit=${FLAT_PAGE_SIZE}&offset=${state.flatOffset}`;
    let payload;
    try {
      payload = await request(root, state, path, { method: "GET", headers: {} });
    } catch (error) {
      if (state.status !== "pending" || error.status !== 404) throw error;
      payload = await request(root, state, `/admin/pending?limit=${FLAT_PAGE_SIZE}&offset=${state.flatOffset}`, { method: "GET", headers: {} });
    }
    if (!Object.prototype.hasOwnProperty.call(payload, "total")) {
      payload.total = Array.isArray(payload.comments) ? payload.comments.length : 0;
      payload.limit = FLAT_PAGE_SIZE;
      payload.offset = 0;
      payload.hasMore = false;
    }
    renderFlat(root, state, Array.isArray(payload.comments) ? payload.comments : [], payload);
  }

  async function load(root, state) {
    const panel = q(root, "[data-comments-admin-panel]");
    panel.setAttribute("aria-busy", "true");
    try {
      if (state.status === "approved" && state.view === "detail" && state.publishedV3 !== false) {
        await loadArticleConversation(root, state);
      } else if (state.status === "approved" && state.view === "list" && state.publishedV3 !== false) {
        try {
          await loadPublishedArticles(root, state);
          setStatus(root, state.search ? "文章搜尋結果已載入。" : "已公開文章已載入。", "success");
        } catch (error) {
          if (error.status !== 404) throw error;
          state.publishedV3 = false;
          state.view = "list";
          state.flatOffset = 0;
          setToolsVisibility(root, state);
          q(root, "[data-comments-admin-heading]").textContent = "已公開";
          await loadFlat(root, state);
          setStatus(root, "目前 Worker 尚未提供 Article-first API，已安全退回相容的已公開留言清單。", "");
        }
      } else {
        await loadFlat(root, state);
        setStatus(root, `${STATUS_LABELS[state.status]}留言已載入。`, "success");
      }
      q(root, "[data-comments-admin-login]").hidden = true;
      panel.hidden = false;
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
    const state = {
      token: "",
      status: "pending",
      view: "list",
      articleKey: "",
      currentArticle: null,
      flatOffset: 0,
      articleOffset: 0,
      search: "",
      searchResults: null,
      publishedV3: null,
      manifest: parseManifest(root),
    };
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

    const searchForm = q(root, "[data-comments-admin-search-form]");
    const searchInput = q(root, "[data-comments-admin-search]");
    if (searchForm && searchInput) {
      searchForm.addEventListener("submit", async event => {
        event.preventDefault();
        state.search = searchInput.value.trim();
        state.searchResults = null;
        state.articleOffset = 0;
        await load(root, state);
      });
      q(root, "[data-comments-admin-search-clear]")?.addEventListener("click", async () => {
        searchInput.value = "";
        state.search = "";
        state.searchResults = null;
        state.articleOffset = 0;
        await load(root, state);
      });
    }

    q(root, "[data-comments-admin-back]")?.addEventListener("click", async () => {
      state.view = "list";
      state.articleKey = "";
      state.currentArticle = null;
      setToolsVisibility(root, state);
      await load(root, state);
    });

    q(root, "[data-comments-admin-prev]")?.addEventListener("click", async event => {
      const mode = event.currentTarget.dataset.paginationMode;
      if (mode === "articles") state.articleOffset = Math.max(0, state.articleOffset - ARTICLE_PAGE_SIZE);
      else state.flatOffset = Math.max(0, state.flatOffset - FLAT_PAGE_SIZE);
      await load(root, state);
    });
    q(root, "[data-comments-admin-next]")?.addEventListener("click", async event => {
      const mode = event.currentTarget.dataset.paginationMode;
      if (mode === "articles") state.articleOffset += ARTICLE_PAGE_SIZE;
      else state.flatOffset += FLAT_PAGE_SIZE;
      await load(root, state);
    });

    q(root, "[data-comments-admin-refresh]").addEventListener("click", () => {
      state.searchResults = null;
      return load(root, state);
    });
    q(root, "[data-comments-admin-logout]").addEventListener("click", () => clearAuth(root, state));
  }

  const start = () => document.querySelectorAll(".huikai-comments-admin").forEach(init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
