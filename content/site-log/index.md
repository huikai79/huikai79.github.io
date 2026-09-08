---
title: "網站紀錄"
layout: "simple"
description: "記錄本站各階段完成的重要功能、延後決策與待完善事項。"
showBreadcrumbs: false
showDate: false
showAuthor: false
showReadingTime: false
showWordCount: false
showComments: false
showRelatedContent: false
showPagination: false
sharingLinks: []
build:
  list: never
  render: always
---

- 本頁只記網站里程碑、成熟後再評估事項與下一輪可完善處；一般小修補不逐項記錄。

## 2026-09-08｜網站系統整合階段完成

### 已完成

- 完成 Notion → Hugo → Blowfish → GitHub Pages 正式內容發布鏈路。
- 完成 Notion `Published + Public` 發布契約與 Test／Public 內容隔離。
- 完成增量同步、刪除隔離、候選快照驗證與 exact-SHA deployment。
- 完成首頁內容選擇／輪替與 Notion `Home` 欄位治理。
- 完成文章 Category、Type、Tag、Explore 與站內搜尋入口。
- 完成 zh-TW／zh-CN 語言路由、舊網址 alias 與翻譯治理基礎。
- 完成 Social Preview／Open Graph 與文章社群分享。
- 完成 Giscus 留言，並讓留言主題同步網站亮／暗模式。
- 完成 Notion 圖片、封面、媒體容量與檔案預算治理。
- 完成 Notion Audio Gateway；正式頁面可播放並支援 Range request。
- 完成 Notion Video Gateway；正式頁面 MP4 可播放、seek，並支援 Range request。
- 完成公開文章的 comments policy、media source contract 與 rendered-site verification。
- 完成 Notion 作者工作 Views：寫作工作台、已發布、測試內容、翻譯工作、發布檢查。
- 完成 Umami Analytics 的非啟用預備設定；尚未填入 Website ID，因此目前不追蹤訪客。

### 待條件成熟再評估

- Managed media 接近現有 100 MiB 管理預算，或大型影音需求明顯增加時：重新評估 Cloudflare R2／object storage。
- 正式文章約達 30–50 篇時：重新檢查 Category／Tag 的 canonical taxonomy 與命名治理。
- 翻譯文章約達 10 篇以上，或來源文章開始頻繁修訂時：評估自動 stale detection 與 translation refresh。
- 正式內容約達 50 篇以上，或讀者開始難以找到舊內容時：重新評估搜尋排序、推薦與相關文章策略。
- 留言量、垃圾訊息或管理負擔明顯增加時：評估 moderation、通知與社群管理流程。
- 同步／建置時間持續明顯上升時：再評估 cache、圖片處理與 pipeline 效能優化；目前不為預期中的未來規模提前加複雜度。

### 下次可完善

- 取得 Umami Website ID 後正式啟用 Analytics，再以真實讀者資料決定後續 UX 調整。
- 壓縮目前超過 media warning threshold 的舊封面，降低 repository 與 build 的媒體負擔。
- 整理 legacy 簡體 Tag 與未來 canonical taxonomy 的顯示名稱／URL 策略。
- 逐篇決定哪些 Test 內容值得修訂後轉成正式文章，不批次公開。
- 進一步分離文章 Hero cover 與 1200×630 Social Preview 圖片來源，讓 SVG／raster 使用情境更清楚。
- 隨正式內容增加，定期做一次桌機／手機、亮／暗模式與主要瀏覽器的讀者端回歸檢查。
