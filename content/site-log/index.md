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

## 2026-09-16｜文章列表預覽節奏與讀後導覽完成收斂

### 有圖／無圖文章的共通版面契約

- `/posts/` 文章列表完成有圖／無圖混排的幾何收斂：桌面版固定文字欄的起訖位置與閱讀寬度，Hero 只作 optional media enhancement；沒有 Hero 的文章不補 placeholder，也不把短效或無關圖片硬塞進版面。
- 桌面 `853px+` 的文章 preview 設定 180px minimum block height，讓無 Hero 文章保留足夠垂直呼吸、避免下一篇標題過度貼近；手機版則維持自然高度，不保留桌面用的空白。
- 「繼續閱讀」維持文字優先的 secondary discovery surface，不改成第二份 Archive；只小幅放鬆標題與項目垂直節奏，摘要固定最多兩行，保留比主要文章目錄更緊湊的層級。

### 回歸驗證與正式上線

- 新增 post preview geometry regression，直接量測有圖／無圖文字欄左右邊界、300px media 欄、桌面 minimum height、文章起點 cadence、853px breakpoint 與 390px 手機回收行為；驗證不再只依賴「沒有 horizontal scrollbar」。
- PR #166 先完成文字欄與 Related reading geometry／rhythm 修復；PR #167 再補上無圖文章的 desktop vertical rhythm。兩輪候選均通過 Hugo build、Chromium／Firefox／WebKit、CJK 長文、TOC、留言、回到頂部與 targeted geometry QA。
- PR #167 最終 merge commit 為 `0256dfddec6a49e7820f1fa57bd267343c07164f`；deployment run `35081777834` 精確建置並部署同一 SHA 到 GitHub Pages，正式站的 changed-route、reader、post preview geometry／related-reading、TOC、CJK 與 back-to-top live QA 全部通過。

## 2026-09-16｜文章列表、讀後導覽與作者／分享語意重新整理

### Archive、Related 與無圖文章

- `/posts/` 文章 Archive 改以穩定文字資訊作為骨架：標題、日期／閱讀時間與 Notion `Summary → description` 摘要固定存在，桌面只在有圖時於右側補上 optional thumbnail；手機維持圖片在上、文字在下。沒有 Hero 的文章不再補 placeholder，也不再為了版面完整度強迫產生圖片。
- Related Articles 從固定 3 欄圖片卡改為完整寬度的純文字閱讀清單，使用標題、meta 與 editorial description；0／1／2／3 篇都能維持完整構圖，也不再因單篇推薦只佔三分之一欄而留下大面積空白。
- 摘要行為收斂在文章探索 surface，本次沒有打開全站 `list.showSummary`，也沒有新增 Notion 欄位；既有 `description` 繼續是 Archive／Related 的單一 editorial summary 來源。

### 作者身份與分享入口

- 文章底部的「作者」改為「關於我」，保留頭像、名稱與簡介並連回 About；Facebook／GitHub／Spotify 不再與文章分享按鈕並列，而是移到 About 的「其他地方」，且直接重用既有 author links 設定，不建立第二份 URL 資料。
- 五個分享平台收進原生 `<details>/<summary>` 的「分享本文」入口，並加入平台中立的「複製連結」與成功／失敗回饋；整體不引入新的 UI framework。
- 這次調整把 Homepage、Archive、Related 的工作分開：首頁負責遇見內容，Archive 負責時間軸掃描與回找，Related 只負責讀完後的下一步，不再要求三個 surface 使用同一種卡片視覺。

### 最新真實資料、部署與 live 驗證

- PR #160 在 merge 前通過 Hugo validation、Chromium／Firefox／WebKit 跨瀏覽器 QA，以及 latest production Notion materialized preflight；preflight 讀取 27 筆正式內容，27 筆全數沿用、0 rebuilt、0 deleted，完整 `build-and-verify` 通過且沒有產生額外 material change。
- PR #160 合併後建立正式 main commit `c30ada37427c94dbe2ee885db7c8d056e09e167a`；validator run `35048246718` 重新以最新 Notion production state 驗證同一 SHA，沒有建立第二個同步 commit；deployer run `35048353655` 隨後精確建置並部署 `c30ada…` 到 GitHub Pages。
- 正式 deployment 後的 live-reader QA 再次通過文章閱讀、TOC、CJK 長文、回到頂部與首頁入口等行為。Cloudflare purge 目前未設定，因此該步驟未執行；但 Pages deployment 與 live production 驗證均成功。

### Changed-route live QA 與 publication rights advisory

- PR #161 補上 exact-commit changed-route production QA：由實際部署 commit diff 推導受影響的 zh-TW／zh-CN 文章路徑，桌面與手機分別檢查 HTTP、route、H1、正文、overflow 與 broken image；刪除路徑也會驗證不得殘留 2xx。
- 把兩個曾實際出現的內容語義錯誤升格為 live regression：`/posts/menulis-dalam-masyarakat-rencam/` 必須保留正常段落／divider、不得產生誤判 H2／TOC；`/posts/writing-advice/` 的一般 YouTube URL 必須保持 hyperlink，不得轉成對應 iframe。
- Notion 新增獨立 `Source Use` select（`Original / Reference`、`Excerpt`、`Translation`、`Republication`、`Adaptation`），publication contract 會和 `Rights Status`、source-rights registry 一起產生可追溯 evidence。遷移階段 rights 缺口維持 non-blocking advisory；首次 production contract 顯示 27 筆正式內容中 25 筆仍缺 `Source Use`、需要後續整理，這是 metadata completeness 問題，不代表已完成權利判定。
- PR #161 merge commit `ae05e95ed300c51c23abf49ac9607ca1375c11d6` 後，sync run `35049908935` 以最新 Notion production state 重建並驗證 27／27 bundles；最終 material site change 為 false，但 generator contract 更新建立新的同步 state `737647709f32379453a40c2122cc30241a27b568`。deployment run `35050135863` 精確建置並部署 `737647…`，同一 run 的 changed-route QA、content-semantics regression、一般 live-reader、TOC、CJK 長文、回到頂部與首頁入口驗證全部通過。

## 2026-09-15｜文章圖片契約、Notion 語義邊界與 API 韌性補強

### Hero、Social Preview 與來源權利觀測

- 將「沒有 Hero」正式視為合法文章狀態：同步／產生器不再把正文第一張圖片或程序化 fallback 自動升格為 Hero；Social Preview 保持獨立解析與 deterministic fallback，因此「無主圖」不等於「無社群預覽」。
- 撤回 9 月 10 日把 Notion `last_edited_time` 直接當成讀者可見 Hugo `lastmod` 的做法；Notion 編輯時間仍可供 manifest／同步失效判斷，但不再被當成有編輯語義的「文章更新日期」。Hero 在缺少獨立 alt 契約時預設視為 decorative。
- 建立 reusable source-rights registry／resolver，讓 source date 與 rights metadata 可以進入 publication contract 與測試；目前採 observability-first，不因新增權利資料就突然阻擋既有內容。外部 canonical source 的翻譯 bundle 也補上正確 routing，既有 translation target 可由 canonical source deterministic backfill 缺少的來源 metadata。
- 正式內容同步新增《AI 時代，寫部落格依然值得》繁體版本與《寫作建議》簡體版本；9 月 15 日末 production 內容總數收斂為 27 篇／語言版本。

### Notion → Markdown 語義契約

- 修正普通 YouTube hyperlink 被全域 regex 誤轉成播放器 shortcode 的問題；現在只有真正的 Notion external YouTube video block 才會轉成 Hugo YouTube player，uploaded MP4 仍走既有 `notion-video` gateway。
- Notion divider 改輸出 `* * *`，避免裸 `---` 緊貼前一個非空白 block 時被 Markdown 誤解成 Setext heading、污染正文與 TOC。
- 新增 Markdown semantic contract 並接入 `build-and-verify.sh`：拒絕 shortcode 落入 Markdown link destination，也檢查 `---`／`===` 的 Setext ambiguity，讓 converter 的語義錯誤在進入公開頁面前失敗。

### Notion API transport 與 rate-limit 韌性

- 將 Notion 存取收斂到共享 transport，涵蓋 publication contract、正式 sync、staged page checks、metadata enrichment、targeted／automatic translation 與 external URL ingestion；CI 也檢查這些 consumer 不再各自繞過共同 transport。
- 對 HTTP 429／529 優先遵守 `Retry-After`，否則使用有上限的 exponential backoff + jitter；一般 5xx 只對可安全重試的 read／idempotent 請求重試，不重送有副作用的 unsafe write。
- 這輪修改在 9 月 15 日完成 production materialization 後，由 main sync state `4003dac818c80098f13a49721dfbbf4e4180d842` 收斂；後續 9 月 16 日 exact-main production deployment 已包含上述全部變更並通過 live reader QA。

## 2026-09-14｜發布流程單一化、完整候選驗證與 taxonomy 修復

### Main release orchestration 與 full-candidate gate

- 審計 GitHub Actions 後確認，`main-code-release.yml` 與 `sync.yml` 曾形成兩條獨立的 main production release lane；實際 9 月 14 日 run 證明 code-only deployment 可先於最新 Notion materialized state 完成，造成「新程式已上線、最新 CMS 內容尚未 materialize」的中間狀態。現在移除第二條 release lane，由 `sync.yml` 單獨負責 main push 的 production orchestration；exact-SHA `deploy.yml` 仍保留為部署邊界。
- `sync.yml` 新增 `preflight_only`、`candidate_ref` 與 `force_deploy`，並把 publication contract、Notion sync、媒體／多語資源處理、homepage runtime、Hugo build 與 rendered contracts 收斂成同一條 production-equivalent candidate pipeline。main push 必須先通過最新真實上游資料的完整候選驗證，再決定 commit 與 deployment；manual／health no-op 不再為了「最後一個綠燈」重複部署同一 state。
- 這次 production run 實際讀取並驗證 25 筆正式內容，14 筆沿用、11 筆重建；full candidate 通過後由 creator run `34862294908` 建立 synchronized commit `08cc7cda61133b9c5b53e55a7793de694b12861a`，deployer run `34862517878` 精確建置並部署同一 SHA，deployment 與 production live-reader QA 全部成功。

### zh-CN taxonomy producer 修復與回歸前移

- full candidate gate 實際抓到新的 blocker：`formats/紀錄` 在 zh-CN 文章、Explore 與 term page 仍顯示繁體「紀錄」，但 reader label 應為「纪录」。既有 verifier 判斷正確，因此沒有放寬檢查，而是回到 producer 與共同 localization mapping 修復。
- 將 zh-CN taxonomy presentation mapping 集中成共同 contract，文章 format chip 改用 Hugo term `LinkTitle`，canonical taxonomy identity／URL 仍維持 `紀錄`；同時補齊固定 Type vocabulary 的 `札記 → 札记`、`紀錄 → 纪录` term override。
- 新增 source-level taxonomy localization regression：即使某個合法 Type 目前尚未被任何 production 文章啟用，也會檢查其 reader-facing localization 是否已完整定義。這使「PR snapshot 全綠，但新 CMS 值第一次 materialize 才爆炸」的失敗模式能更早被發現。

## 2026-09-13｜外部閱讀收件、翻譯自動化與發布鏈閉環

### 外部 URL 收件與文章發布

- 完成 External Reading URL Ingestion MVP：Notion 新增 `Ingestion Status`、`Canonical URL`、`Source Hash`、`Retrieved At`、`Source Published At`、`Ingestion Note`、`Rights Status`，並建立「📥 外文閱讀收件箱」。作者只要先放入 `Source URL`，背景流程即可辨認待處理項目。
- ingestion worker 以排程／手動方式運作，v1 僅接受一般英文 HTML；會檢查 URL scheme、credentials、DNS／IP、redirect、content type、timeout 與 response size，阻擋 private／loopback／link-local 等位址。成功內容只進入 `Draft + Test + Translation Status=Source + Rights Status=Unknown`，重複或不支援來源則標成 `Duplicate`／`Needs Review`，不自動翻譯、核准或公開。
- 正式發布《如何讓一個想法生長》、《小寫 b 的部落格寫作》與《我的網站是知識之河旁一棟不斷變動的房子。你的呢？》；補齊來源、摘要、分類、類型、Canonical URL、來源日期與 semantic cover，並修正「只是之河」為「知識之河」。三篇通過 publication contract、Notion sync、Hugo build、GitHub Pages deployment 與 production reader QA。

### Transmith 從單篇批准走到 Notion-native 自動佇列

- 先完成 targeted translation approval guard：任何付費 `apply=true` 都必須明確指定一個 canonical Notion Source page ID／URL；resolver 會驗證 Source、Translation Group、readiness、資料庫成員資格與唯一候選，不能由操作者直接塞入 Translation Group。同步觸發仍只做全庫 preflight，因此保留單篇人工 fallback 而不會誤掃整池付費翻譯。
- 實際以《小寫 b 的部落格寫作》完成第一個 targeted zh-CN Draft；過程也確認 GitHub Actions 使用的 Notion integration 必須具備 Insert content capability。權限補齊後，Draft 正確保留 `Draft + Test`，並寫入 Translation Source／Group／Source Revision／Engine／Profile／Config Fingerprint。
- 完成 Notion-native automatic translation queue：正式 Source 只要符合 `Published + Public + Translation Status=Source` 且勾選 `Translate To`，背景流程便會每 15 分鐘及成功 Notion sync 後自動尋找缺少的目標語言。每輪最多建立 2 個新 Draft，既有目標語言一律跳過，不自動覆寫，也永遠不自動 `Approved` 或 `Published`。
- automatic queue 對文章本身的 unsupported block／media 採非致命 blocker，避免一篇異常卡死整批；OpenAI、Notion 寫入或缺少必要 API key 等 runtime 問題則會明確失敗。第一輪 production 自動化已實際建立《如何活著》zh-TW 與《我的網站是知識之河旁一棟不斷變動的房子。你的呢？》zh-CN Draft，兩篇均驗證為 `Draft + Test` 且 provenance 完整；既有《小寫 b》zh-CN 被正確跳過。
- 《如何讓一個想法生長》zh-CN 目前仍因正文含 Notion-hosted/file-upload 圖片而被 durable-media contract 安全阻擋；系統沒有複製短效 signed URL，也沒有因此阻塞其他文章翻譯。

### 部署可靠性與留言管理正式整合

- Comments Admin V3 已由候選實作合併進 `main`，article-first 管理與 build-time article manifest 因此進入正式網站程式；對應 exact-main GitHub Pages deployment 已成功。Comments Worker 是獨立 deployment surface，本筆不以 Pages 成功推定 Worker 已同步到同一版。
- 修正 Notion sync「push 新 main 後立即 dispatch deployment」的競態：workflow_dispatch context 曾仍綁定上一個 `GITHUB_SHA`，導致正確的新 main 被 lineage guard 誤拒。現在 guard 直接讀取遠端 `refs/heads/main`，仍要求 requested SHA 等於當前 main，且後續 exact checkout、main 未移動檢查、Pages artifact 與 live QA 邊界全部保留。
- 修正後的 exact-main deployment 已在 production 成功；Notion-native automatic translation queue 合併後，code-only release、Notion sync 與 GitHub Pages deployment 亦再次成功，確認新自動化已進入正式 `main`，而不只停留在 PR 候選。

## 2026-09-12｜Entry Header 與 Transmith 翻譯基礎補齊

### 內容入口視覺系統

- Posts、Projects、Explore、About 共用 HUIKAI Entry Header v2：桌面統一較強的 H1 尺度、lead 寬度／字級與低調分隔線，手機則保留較克制的 36px 標題，避免 CJK 窄螢幕標題過度膨脹。
- 這次只統一入口層的 title／lead／spacing grammar，不重做 Projects 卡片、taxonomy 元件或 About 長文結構；候選曾以 4 類頁面 × 桌面／手機 × 亮／暗模式共 32 張截圖檢查，未發現水平 overflow。

### Transmith runtime、English Source 與 readiness 分層

- 將 Transmith v2.5 的規則落成可執行 translation runtime profile，加入 `Translation Brief`、段落／區塊語境、Translation Profile 與 Config Fingerprint；既有翻譯不會被自動覆寫，revision／config 差異可被辨認為 stale 訊號。
- `Language=en` 正式成為可翻譯的 Source language，但目標仍只允許 `zh-TW`／`zh-CN`；英文 Source 不會直接進入 Hugo 公開內容，因此擴大來源能力沒有等同新增英文網站 locale。
- translation readiness 與 publication readiness 正式拆開：`Translate To` 可以選出待翻譯 Source，不再要求來源先 `Published`；缺少顯式 Summary 時可由正文產生 deterministic translation-only fallback，且 date／slug／Category／Type 僅在存在時繼承到 Draft。production publication 的 Summary 等 metadata gate 維持原規則，不因翻譯需求而放寬。

## 2026-09-12｜留言管理 V3 完成候選實作與驗證

### Article-first 管理與可達性

- 「已公開」留言管理由 status-first 扁平清單改為 article-first：先依文章與最近活動找到討論，再進入文章內管理完整 thread；待審核仍維持 queue-first，已隱藏仍作為可恢復的 recovery queue。
- Worker 新增 `/admin/articles`，並讓文章內留言查詢支援 `articleKey + limit + offset + total + hasMore`；原本超過 100 則後新留言可能不可到達的限制已由真正分頁取代，並加入 101+ 留言回歸。
- Published 管理改用 effective public visibility：hidden root 下仍為 `approved` 的 descendants 不再被誤算成讀者可見；文章內仍保留 direct-reply、作者身份與讀者／管理員 tombstone，對話資料語意不因管理介面扁平化而遺失。
- Hugo build-time article manifest 以 `commentKey` 對應文章標題、路徑與語言，不把文章標題重複寫入 D1；多語文章採 exact path 優先、單一 variant fallback，遇到多個 variant 時明確顯示而不自行猜測。
- V3 前端若遇到尚未升級的 Worker `/admin/articles` 404，會安全退回 V2 Published 清單，讓 Pages 與 Worker 可以分階段部署而不讓管理頁暫時失效。

### 驗證與部署邊界

- Worker runtime tests 已涵蓋 article pagination、多文章排序、101+ comments pagination、hidden-root effective visibility、tombstone 與 article conversation 分頁；既有 withdrawal、direct reply、author reply 與 lifecycle 行為保留。
- Hugo 0.165.0 完整 build、管理路由隱私檢查與 Playwright V3 moderation browser QA 均已通過；瀏覽器驗證涵蓋 article-first 列表、真實文章標題映射、搜尋、文章 drill-down、direct-reply／tombstone，以及桌面與手機版面契約。
- 驗證過程曾實際抓到 article manifest 在 `<script>` context 被二次 JSON 編碼；最後改以正確的 JSON producer 與 `safeJS` 輸出後，同一套 browser contract 通過，未以放寬測試方式繞過問題。
- V3 不需要新的 D1 migration，也沒有修改 Notion 內容模型或文章資料。此筆紀錄寫入時，功能已完成候選實作與驗證；production 合併、Pages／Worker 部署與 live source lineage 仍須分別確認，不以候選 CI 代替正式上線證據。

## 2026-09-11｜留言生命週期與多輪對話管理完成

### 留言生命週期與對話語意

- HUIKAI 自有留言從單輪審核擴充為完整生命週期：管理端區分「待審核／已公開／已隱藏」，已公開留言可隱藏後再恢復；刪除時則依是否存在後續回覆決定永久刪除或保留匿名 tombstone，避免破壞既有對話脈絡。
- 讀者撤回語意同步補齊：尚未公開的留言可直接撤回刪除；已公開且已有對話脈絡的內容則轉成「已撤回」節點，兼顧個人撤回權與公開討論的可理解性。
- 新增 `reply_to_id` 與穩定的 root thread 語意，使讀者與 HUIKAI 可以直接互相回覆多輪；資料保留真正的直接回覆關係，讀者介面仍維持最多兩層的平坦閱讀結構，不讓巢狀對話不斷向右縮排。
- 留言保存 `page_path`，管理頁可直接看出留言所屬文章、根留言與實際回覆目標；作者回覆也會沿用同一文章與 thread 脈絡。

### 資料、部署與驗證

- 新增並正式套用 `0002_comment_lifecycle.sql` D1 migration，補上直接回覆、文章路徑與管理員移除標記；既有回覆資料也依舊版 `parent_id` 補上相容的直接回覆目標。
- Worker runtime tests 涵蓋讀者→作者→讀者→作者的多輪回覆、隱藏／恢復、撤回、永久刪除與 tombstone 保留；正式 Worker 亦以 exact-current-main 部署，並透過 `/api/comments/v1/health` 驗證 production source lineage。
- GitHub Pages、跨瀏覽器留言／管理介面驗證與 production live-reader QA 均再次通過；本輪沒有修改 Notion 內容模型或文章資料。

## 2026-09-10｜長文閱讀、文章框架與發布治理完成一輪收斂

### 長文閱讀與中文排版

- 重新整理桌面文章閱讀布局，將正文與右側目錄收斂為更穩定的雙欄結構；作者資訊、分享、上一篇／下一篇、相關文章與留言移入獨立讀後區，維持一致版心，但不再延長正文的 sticky TOC 閱讀階段。
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
- 將留言與讀後導覽正式拆出正文／TOC 閱讀格線，讓 sticky TOC 隨正文結束；留言表單同步收斂高度、空狀態、Turnstile 顯示、欄位語意與狀態處理，降低讀完正文後的視覺競爭。
- 補齊留言區有留言、0 則留言、載入失敗、桌機／手機、亮／暗模式與窄寬 Turnstile 等回歸，並修正專項截圖保存與 production live-reader QA 的結構判斷，使候選版與正式站使用同一套讀後區邊界。
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
- 翻譯文章約達 10 篇以上，或來源文章開始頻繁修訂時：評估自動 translation refresh、Stale 狀態寫回與人工重審策略；目前已能用 Source Revision／Config Fingerprint 辨認 stale 訊號，但不自動覆寫既有翻譯。
- 正式內容約達 50 篇以上，或讀者開始難以找到舊內容時：重新評估搜尋排序、推薦與相關文章策略。
- 垃圾訊息、濫用或通知需求明顯增加時：再評估 spam moderation、通知與更進階的社群管理；不因文章管理需求已成熟而一併擴大功能。
- 同步／建置時間持續明顯上升時：再評估 cache、圖片處理與 pipeline 效能優化；目前不為預期中的未來規模提前加複雜度。

## 下次可完善

- 補齊翻譯 Draft 對 Notion-hosted／file-upload 圖片的 durable-media contract；目前《如何讓一個想法生長》zh-CN 因此安全阻擋，不應以複製短效 signed URL 繞過。
- 取得 Umami Website ID 後再正式啟用 Analytics，並以真實讀者資料決定後續 UX 調整；在此之前不把 Analytics 記為已啟用。
- 逐步壓縮仍超過 media warning threshold 的舊封面，降低 repository 與 build 的媒體負擔。
- 逐篇決定哪些 Test 內容值得修訂後轉成正式文章，不批次公開。
- 當主要版面、內容模型或讀者路徑再次有明顯變動時，除既有自動化 QA 外，再做一次人工的桌機／手機、亮／暗模式與主要瀏覽器視覺巡檢。