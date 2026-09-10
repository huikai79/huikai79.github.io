---
title: "網站紀錄"
layout: "simple"
description: "記錄本站已完成的重要里程碑、產品決策、工程改善與條件式待辦。"
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

- 本頁分成三層：已完成事項按日期留下；需要等規模、資料或使用情境成熟後才值得處理的項目放在「待條件成熟再評估」；已有明確下一步但尚未完成的事項放在「下次可完善」。條件達成且實際完成後，再移入當天紀錄。一般小修補不逐項記錄。

## 2026-09-10｜長文閱讀、文章框架與發布治理完成一輪收斂

### 長文閱讀與中文排版

- 重新整理桌面文章閱讀布局，將正文與右側目錄收斂為更穩定的雙欄結構；作者資訊、分享、上一篇／下一篇、相關文章與留言維持和正文閱讀區對齊。
- 修正文章目錄原本「CSS 看似 sticky、實際捲動卻無法穩定固定」的問題，將 sticky 行為移到真正的 sidebar 容器，並重新接回 Blowfish 原生 `.toc` 與 Smart TOC 行為。
- 1024–1279px 維持文章上方的可收合目錄；1280px 以上才使用右側 sticky TOC，避免中型螢幕被目錄擠壓。
- 桌面 TOC 降低字級與一般項目的視覺權重；目前閱讀中的章節以低調方式加強辨識，不額外建立第二套 scroll-spy。
- 閱讀時間達 8 分鐘以上的文章加入 2px 閱讀進度線；進度只計算正文 `.article-main`，不把作者卡、分享、相關文章、留言與 footer 算入，因此讀完正文時即到達 100%。
- H2／H3 增加有節制的垂直留白，讓長文章在章節轉換時有較自然的呼吸節奏。
- 文章 H1／H2／H3 使用 balanced wrapping，降低窄螢幕上中文標題出現孤字或過短尾行的機率。
- zh-TW／zh-CN 文章正文加入較嚴格的 CJK 換行處理，同時保留既有 overflow safety；不為追求「日系感」加入額外正文字距或全文左右對齊。
- 實際瀏覽器量測確認目前正文約為 16px 字級、28px 行高、約 42 個 CJK em／行，因此保留現有正文寬度與密度，不再憑 `80ch` 單位推測中文字行過寬。

### 導覽、回到頂部與頁尾

- 繁體／簡體、桌面／手機的主選單移除與左上角 `HUIKAI` 品牌連結功能重複的「首頁／首页」；`HUIKAI` 維持各語言首頁的持續入口，主導航只保留真正不同的目的地。
- 「回到頂部」由固定貼著 viewport 的位置改成閱讀版心感知配置：手機維持傳統右下角，中型螢幕保留安全邊距；寬螢幕有 TOC 時依完整閱讀布局右緣定位，沒有 TOC 的文章則依正文 `.article-reading-content` 右緣定位，不再退回視窗最右側。
- 非文章頁仍保留 viewport fallback，避免把文章版心邏輯錯套到一般頁面。
- 按鈕延後到捲動約兩個 viewport 後才出現，降低閱讀初段干擾；接近 footer 時會自動上移，不遮住頁尾資訊。
- 隱藏狀態同步退出鍵盤焦點與 pointer interaction，並保留 44×44px 點擊範圍與可見 focus 狀態。
- 頁尾 Hugo／Blowfish 技術 attribution 保留，但縮小到較低視覺層級，避免與 copyright 及正文競爭注意力。
- 新增繁簡、桌機首頁入口與有／無 TOC 的回到頂部瀏覽器回歸，讓這些讀者路徑不只依 CSS 靜態判斷。

### 文章資訊與閱讀框架

- 將 Notion `last_edited_time` 正式投影為 Hugo `lastmod`，文章可以區分「發表」與真正有意義的「更新」。
- 文章形式與成熟度改以較自然的讀者語言呈現；作者區由較強烈的卡片感收斂成較安靜的 editorial footer。
- 新增繁體／簡體 `/now/` 頁面作為「目前正在關心與進行什麼」的輕量入口，但不塞入主要導覽。
- About 加入較精簡的入口層，同時保留「澄心之遊」完整脈絡；簡體 About 也同步到同一套核心內容，並加入繁簡一致性驗收。
- 修正桌面搜尋控制項的尺寸與內容容納問題，恢復較符合 Blowfish 原生行為的呈現。

### Notion 內容治理與翻譯 staging

- 將 Notion 舊 `Text` 欄位整理為 `Source`，新增 `Source URL`，讓來源名稱與網址可以成對管理；既有來源資料保留。
- 將內容與翻譯支援語言收斂到網站實際提供的 `zh-TW`／`zh-CN`，避免資料模型宣告網站尚未真正支援的語言。
- 重新整理翻譯工作視圖與發布檢查，使真正的翻譯頁面、Test staging 與 Public 發布狀態更容易區分。
- 完成來源追溯、Translation Group、Translation Source Revision、Translation Engine 等翻譯治理契約；原文仍可在 Test 階段準備翻譯草稿，不必先公開。
- 翻譯流程缺少 OpenAI API key 時會安全退回 preflight，只產生檢查結果，不建立不完整草稿。

### 留言、發布流程與驗證

- 正式留言由 Giscus 切換到 HUIKAI 自有的免帳號留言服務；既有 Giscus 保留為可驗證的 rollback 路徑，而不是同時在 production 載入兩套留言系統。
- 將純程式／CSS／模板的 code-only release 與 Notion publication health 適度解耦，避免某一篇 Notion 內容資料異常時，連無關的前端修正都無法發布。
- Notion publication health 改由唯讀流程檢查；真正同步仍維持 fail-closed，且 exact-current-main／exact-SHA 部署邊界保留。
- 重要讀者行為不再只檢查 CSS 或 build 是否成功，而是由 Playwright 實際操作與量測。
- production reader QA 已涵蓋 TOC responsive／sticky、長文閱讀進度、CJK 排版、首頁入口、回到頂部定位、留言區與 footer 避讓等行為。
- 本日整合後的正式 `main` 以 exact commit 建置與 GitHub Pages 發布；部署後亦以 `source-commit.txt` 核對 production 實際提供的來源版本。

## 2026-09-09｜首頁定位、多語言與內容探索重新整理

### 首頁與品牌層級

- 將網站核心由較分散的領域式自我介紹收斂為 **HUIKAI／澄心之遊**，首頁主文案確立為「記錄那些值得長期保留的價值。」
- 首頁保留「遊而澄心：在所見、所學、所歷之間，讓雜質慢慢沉下，留下值得回望的自己與價值。」作為較低調的精神補充，不再用更多口號與領域清單增加首頁負擔。
- 首頁 CTA 層級重新整理：「閱讀文章」作為主要入口，「瀏覽專案」與「關於我」退為次要入口。
- 首頁與 About 的繁體／簡體 site metadata、品牌文字及回歸驗收同步對齊「澄心之遊」。
- 一般文章／探索清單預設改採較安靜的 editorial list 呈現；Projects 因需要辨識獨立成果，仍保留卡片形式。
- 相關文章由 5 篇縮減為 3 篇，降低文章讀完後的資訊密度。

### Projects 與外部平台角色

- AFP 正式成為 Projects 中的一級專案，而不是只掛在 About 裡作身分補充。
- Devpost 被重新定位為比賽／提交活動的外部佐證，不再作為主要 Projects 入口，也不讓外部平台取代 HUIKAI 作為 canonical project surface。
- Nutrient Hackathon 的舊專案網址保留作歷史 case bridge，但不再與長期專案卡片並列；相關比賽經驗回到文章與歷史脈絡中閱讀。
- Projects 因此更明確地用來保存具有獨立成果、系統或生命週期的長期實作，而不是把每一次參賽紀錄都視為正式專案。

### 多語言閱讀與 taxonomy

- 修正繁體／簡體文章同 slug 時的 canonical route ownership，避免非預設語言的舊 alias 覆蓋真正的繁體 canonical page。
- ambiguous legacy root 改為 fail closed，不再任意挑一個語言版本；build 後會再次檢查 canonical URL、language、redirect 與 `noindex` 狀態。
- 完成繁簡文章的 `hreflang`／canonical 驗證，只有真正存在的翻譯 counterpart 才會對外宣告。
- 保留既有 taxonomy identity／歷史 URL，同時讓簡體讀者看到對應的簡體 Category／Tag 名稱，不為翻譯顯示而破壞原有網址。
- 新增實際文章級語言切換 QA，直接驗證 zh-CN → 繁體 → zh-TW → 简体 → zh-CN 的往返，以及 `html lang`、canonical 與無 meta-refresh 行為。
- 翻譯模型的付費 apply 行為改為明確的手動操作；自動流程主要負責 preflight／觀測，避免同步事件意外建立翻譯草稿或產生模型費用。

### 工程可靠性

- GitHub Actions 的外部 action reference 固定到完整 immutable SHA，並加入驗證，避免日後重新出現浮動 tag／branch 依賴。
- 已啟用 `Protect main` Ruleset，只套用 `main`，禁止 branch deletion 與 non-fast-forward（force push），且未設定 bypass actor，降低主分支遭誤刪或改寫歷史的風險。
- 建立每週 Chromium、Firefox、WebKit 跨瀏覽器讀者品質檢查，涵蓋代表性 responsive 頁面、亮／暗模式、鍵盤操作、基本 target size 與 WCAG A／AA axe 檢查。
- 多語言路由、Projects 版面與首頁／列表調整也納入實際 render 與瀏覽器回歸，而不只依賴 Hugo build。

## 2026-09-08｜網站系統整合階段完成

### 已完成

- 完成 Notion → Hugo → Blowfish → GitHub Pages 正式內容發布鏈路。
- 完成 Notion `Published + Public` 發布契約與 Test／Public 內容隔離。
- 完成增量同步、刪除隔離、候選快照驗證與 exact-SHA deployment。
- 完成首頁內容選擇／輪替與 Notion `Home` 欄位治理。
- 完成文章 Category、Type、Tag、Explore 與站內搜尋入口。
- 完成 zh-TW／zh-CN 語言路由、舊網址 alias 與翻譯治理基礎。
- 完成 Social Preview／Open Graph 與文章社群分享。
- 完成文章 Hero cover 與 Social Preview 圖片來源分離；Hero 可保留 SVG，社群預覽仍維持 1200×630 raster 契約。
- 完成既有 Tag URL identity 保留與語言別顯示名稱；正體站可顯示正體名稱，同時不破壞歷史 taxonomy URL。
- 完成 Giscus 留言，並讓留言主題同步網站亮／暗模式。
- 完成 Notion 圖片、封面、媒體容量與檔案預算治理。
- 完成 Notion Audio Gateway；正式頁面可播放並支援 Range request。
- 完成 Notion Video Gateway；正式頁面 MP4 可播放、seek，並支援 Range request。
- 完成公開文章的 comments policy、media source contract 與 rendered-site verification。
- 完成 Notion 作者工作 Views：寫作工作台、已發布、測試內容、翻譯工作、發布檢查。

## 從 Git 回溯的早期歷史

- 2026-09-08 以前的架站階段當時尚未整理進本站「網站紀錄」。以下依 repository 的 commit 時間、訊息與實際變更回溯重建，只保留可確認的主要里程碑；重複的自動同步與一般小修補不逐筆抄錄。

### 2025-07-31｜Notion 同步開始留下可追溯版本

- 至少自 2025-07-31 起，Git 歷史已持續出現由自動流程寫入的 `🔄 Sync from Notion` commits，顯示內容工作流已從純手動 Hugo 檔案逐步轉向 Notion 驅動。
- 這些同步紀錄後續延續到 2026 年，成為現在 Notion → Hugo 發布系統的前身；這裡只保留階段性里程碑，不把每次同步當成一筆網站大事。

### 2025-07-06–07｜自動建置與部署開始成形

- 2025-07-06 的 Git 紀錄加入 `hugo.yml`，GitHub Actions 開始承擔 Hugo 網站的自動建置／發布工作。
- 2025-07-07 清理最初的 Blowfish submodule／bootstrap 殘留；同日亦留下 `trigger new Cloudflare deployment` 的 commit，顯示早期已在調整部署與託管方式。
- 當時架構仍在試驗，不能用今天的 exact-SHA、Notion publication contract 與 production QA 標準倒推早期系統已具備同等治理。

### 2025-07-05｜Hugo／Blowfish 網站起點

- GitHub repository 建立於 2025-07-05；目前 Git 歷史的 root commit 為 `4c4bace`（`Vendor bootstrap theme`），是可追溯的網站程式起點。
- 初始版本已採 Hugo + Blowfish；最早的 `hugo.toml` 使用 `https://huikai79.com.kg/`，預設內容語言仍是 English，之後才逐步演變為今天以繁體中文為主、支援簡體中文的 HUIKAI。
- 這一階段主要建立可運行的靜態網站骨架；後來的 Notion CMS、多語言、媒體 gateway、Reader QA 與發布治理，都是在這個基礎上逐步形成。

## 待條件成熟再評估

- Managed media 接近現有 100 MiB 管理預算，或大型影音需求明顯增加時：重新評估 Cloudflare R2／object storage。
- 正式文章約達 30–50 篇時：重新檢查 Category／Tag 的 canonical taxonomy 與命名治理。
- 翻譯文章約達 10 篇以上，或來源文章開始頻繁修訂時：評估自動 stale detection 與 translation refresh。
- 正式內容約達 50 篇以上，或讀者開始難以找到舊內容時：重新評估搜尋排序、推薦與相關文章策略。
- 留言量、垃圾訊息或管理負擔明顯增加時：重新評估 moderation、通知與社群管理流程。
- 同步／建置時間持續明顯上升時：再評估 cache、圖片處理與 pipeline 效能優化；目前不為預期中的未來規模提前加複雜度。

## 下次可完善

- 取得 Umami Website ID 後再正式啟用 Analytics，並以真實讀者資料決定後續 UX 調整；在此之前不把 Analytics 記為已啟用。
- 逐步壓縮仍超過 media warning threshold 的舊封面，降低 repository 與 build 的媒體負擔。
- 逐篇決定哪些 Test 內容值得修訂後轉成正式文章，不批次公開。
- 當主要版面、內容模型或讀者路徑再次有明顯變動時，除既有自動化 QA 外，再做一次人工的桌機／手機、亮／暗模式與主要瀏覽器視覺巡檢。