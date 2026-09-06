---
title: "Notion → Hugo 網站發布系統"
description: "把 Notion 內容同步為 Hugo 頁面，並透過 Blowfish 與 GitHub Actions 完成可驗證發布。"
layout: "simple"
weight: 10
showBreadcrumbs: false
---

這是這個網站持續維護的發布系統，也是一個長期工程專案。

它把 **Notion** 作為主要內容來源，經過同步與本地化處理後交給 **Hugo + Blowfish** 生成靜態網站，再由 **GitHub Actions** 負責驗證與部署。

目前已經包含：

- Notion 文章同步與 bundle manifest。
- 臨時媒體本地化，避免頁面依賴會過期的遠端資源。
- 封面解析與發布 gate：優先使用明確封面，其次使用內文首圖；程序化 fallback 僅保留作技術安全網，不作為正式發布封面。
- 以 `contentVisibility` 控制的文章留言策略。
- 1200×630 Open Graph / Twitter Social Preview。
- 文章原生社群分享：Facebook、LINE、WhatsApp、Telegram 與 Email。
- candidate validation 與 exact-SHA GitHub Pages deployment，避免未驗證或過期 commit 被發布。

這套系統的重點不是增加更多依賴，而是讓一般內容維護盡量留在 Notion，同時讓網站建構結果可重複、可檢查、容易恢復。

[查看網站原始碼](https://github.com/huikai79/huikai79.github.io/)
