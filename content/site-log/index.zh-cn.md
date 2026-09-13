---
title: "网站记录"
layout: "simple"
description: "记录本站已完成的重要里程碑、产品决策、工程改善与条件式待办。"
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

- 本页分成三层：已完成事项按日期留下；需要等规模、资料或使用情境成熟后才值得处理的项目放在“待条件成熟再评估”；已有明确下一步但尚未完成的事项放在“下次可完善”。条件达成且实际完成后，再移入当天记录。一般小修补不逐项记录。

## 2026-09-13｜外部阅读收件、翻译自动化与发布链闭环

### 外部 URL 收件与文章发布

- 完成 External Reading URL Ingestion MVP：Notion 新增 `Ingestion Status`、`Canonical URL`、`Source Hash`、`Retrieved At`、`Source Published At`、`Ingestion Note`、`Rights Status`，并建立“📥 外文阅读收件箱”。作者只要先放入 `Source URL`，后台流程即可辨认待处理项目。
- ingestion worker 以排程／手动方式运行，v1 仅接受一般英文 HTML；会检查 URL scheme、credentials、DNS／IP、redirect、content type、timeout 与 response size，阻挡 private／loopback／link-local 等地址。成功内容只进入 `Draft + Test + Translation Status=Source + Rights Status=Unknown`，重复或不支持来源则标为 `Duplicate`／`Needs Review`，不自动翻译、批准或公开。
- 正式发布《如何让一个想法生长》、《小写 b 的博客写作》与《我的网站是知识之河旁一栋不断变化的房子。你的呢？》；补齐来源、摘要、分类、类型、Canonical URL、来源日期与 semantic cover，并修正标题误植。三篇通过 publication contract、Notion sync、Hugo build、GitHub Pages deployment 与 production reader QA。

### Transmith 从单篇批准走到 Notion-native 自动队列

- 先完成 targeted translation approval guard：任何付费 `apply=true` 都必须明确指定一个 canonical Notion Source page ID／URL；resolver 会验证 Source、Translation Group、readiness、数据库成员资格与唯一候选，不能由操作者直接填入 Translation Group。同步触发仍只做全库 preflight，因此保留单篇人工 fallback 而不会误扫整个候选池进行付费翻译。
- 实际以《小写 b 的博客写作》完成第一个 targeted zh-CN Draft；过程中也确认 GitHub Actions 使用的 Notion integration 必须具备 Insert content capability。权限补齐后，Draft 正确保留 `Draft + Test`，并写入 Translation Source／Group／Source Revision／Engine／Profile／Config Fingerprint。
- 完成 Notion-native automatic translation queue：正式 Source 只要符合 `Published + Public + Translation Status=Source` 且勾选 `Translate To`，后台流程便会每 15 分钟及成功 Notion sync 后自动寻找缺少的目标语言。每轮最多建立 2 个新 Draft，既有目标语言一律跳过，不自动覆盖，也永远不自动 `Approved` 或 `Published`。
- automatic queue 对文章本身的 unsupported block／media 采用非致命 blocker，避免一篇异常卡死整批；OpenAI、Notion 写入或缺少必要 API key 等 runtime 问题则会明确失败。第一轮 production 自动化已实际建立《如何活着》zh-TW 与《我的网站是知识之河旁一栋不断变化的房子。你的呢？》zh-CN Draft，两篇均验证为 `Draft + Test` 且 provenance 完整；既有《小写 b》zh-CN 被正确跳过。
- 《如何让一个想法生长》zh-CN 目前仍因正文含 Notion-hosted／file-upload 图片而被 durable-media contract 安全阻挡；系统没有复制短效 signed URL，也没有因此阻塞其他文章翻译。

### 部署可靠性与留言管理正式整合

- Comments Admin V3 已由候选实现合并进 `main`，article-first 管理与 build-time article manifest 因此进入正式网站程序；对应 exact-main GitHub Pages deployment 已成功。Comments Worker 是独立 deployment surface，本笔不以 Pages 成功推定 Worker 已同步到同一版本。
- 修正 Notion sync“push 新 main 后立即 dispatch deployment”的竞态：workflow_dispatch context 曾仍绑定上一笔 `GITHUB_SHA`，导致正确的新 main 被 lineage guard 误拒。现在 guard 直接读取远端 `refs/heads/main`，仍要求 requested SHA 等于当前 main，且后续 exact checkout、main 未移动检查、Pages artifact 与 live QA 边界全部保留。
- 修正后的 exact-main deployment 已在 production 成功；Notion-native automatic translation queue 合并后，code-only release、Notion sync 与 GitHub Pages deployment 亦再次成功，确认新自动化已进入正式 `main`，而不只停留在 PR 候选。

## 2026-09-12｜Entry Header 与 Transmith 翻译基础补齐

### 内容入口视觉系统

- Posts、Projects、Explore、About 共用 HUIKAI Entry Header v2：桌面统一较强的 H1 尺度、lead 宽度／字号与低调分隔线，手机则保留较克制的 36px 标题，避免 CJK 窄屏标题过度膨胀。
- 这次只统一入口层的 title／lead／spacing grammar，不重做 Projects 卡片、taxonomy 元件或 About 长文结构；候选曾以 4 类页面 × 桌面／手机 × 亮／暗模式共 32 张截图检查，未发现水平 overflow。

### Transmith runtime、English Source 与 readiness 分层

- 将 Transmith v2.5 的规则落成可执行 translation runtime profile，加入 `Translation Brief`、段落／区块语境、Translation Profile 与 Config Fingerprint；既有翻译不会被自动覆盖，revision／config 差异可被辨认为 stale 信号。
- `Language=en` 正式成为可翻译的 Source language，但目标仍只允许 `zh-TW`／`zh-CN`；英文 Source 不会直接进入 Hugo 公开内容，因此扩大来源能力并不等同于新增英文网站 locale。
- translation readiness 与 publication readiness 正式拆开：`Translate To` 可以选出待翻译 Source，不再要求来源先 `Published`；缺少显式 Summary 时可由正文产生 deterministic translation-only fallback，且 date／slug／Category／Type 仅在存在时继承到 Draft。production publication 的 Summary 等 metadata gate 维持原规则，不因翻译需求而放宽。

## 2026-09-12｜留言管理 V3 完成候选实现与验证

### Article-first 管理与可达性

- “已公开”留言管理由 status-first 扁平列表改为 article-first：先依文章与最近活动找到讨论，再进入文章内管理完整 thread；待审核仍维持 queue-first，已隐藏仍作为可恢复的 recovery queue。
- Worker 新增 `/admin/articles`，并让文章内留言查询支持 `articleKey + limit + offset + total + hasMore`；原本超过 100 条后新留言可能不可到达的限制已由真正分页取代，并加入 101+ 留言回归。
- Published 管理改用 effective public visibility：hidden root 下仍为 `approved` 的 descendants 不再被误算成读者可见；文章内仍保留 direct-reply、作者身份与读者／管理员 tombstone，对话资料语义不因管理界面扁平化而遗失。
- Hugo build-time article manifest 以 `commentKey` 对应文章标题、路径与语言，不把文章标题重复写入 D1；多语言文章采用 exact path 优先、单一 variant fallback，遇到多个 variant 时明确显示而不自行猜测。
- V3 前端若遇到尚未升级的 Worker `/admin/articles` 404，会安全退回 V2 Published 列表，让 Pages 与 Worker 可以分阶段部署而不让管理页暂时失效。

### 验证与部署边界

- Worker runtime tests 已涵盖 article pagination、多文章排序、101+ comments pagination、hidden-root effective visibility、tombstone 与 article conversation 分页；既有 withdrawal、direct reply、author reply 与 lifecycle 行为保留。
- Hugo 0.165.0 完整 build、管理路由隐私检查与 Playwright V3 moderation browser QA 均已通过；浏览器验证涵盖 article-first 列表、真实文章标题映射、搜索、文章 drill-down、direct-reply／tombstone，以及桌面与手机版面契约。
- 验证过程中曾实际抓到 article manifest 在 `<script>` context 被二次 JSON 编码；最后改用正确的 JSON producer 与 `safeJS` 输出后，同一套 browser contract 通过，未以放宽测试方式绕过问题。
- V3 不需要新的 D1 migration，也没有修改 Notion 内容模型或文章资料。此笔记录写入时，功能已完成候选实现与验证；production 合并、Pages／Worker 部署与 live source lineage 仍须分别确认，不以候选 CI 代替正式上线证据。

## 2026-09-11｜留言生命周期与多轮对话管理完成

### 留言生命周期与对话语义

- HUIKAI 自有留言从单轮审核扩充为完整生命周期：管理端区分“待审核／已公开／已隐藏”，已公开留言可隐藏后再恢复；删除时则依是否存在后续回复决定永久删除或保留匿名 tombstone，避免破坏既有对话脉络。
- 读者撤回语义同步补齐：尚未公开的留言可直接撤回删除；已公开且已有对话脉络的内容则转成“已撤回”节点，兼顾个人撤回权与公开讨论的可理解性。
- 新增 `reply_to_id` 与稳定的 root thread 语义，使读者与 HUIKAI 可以直接互相回复多轮；资料保留真正的直接回复关系，读者界面仍维持最多两层的平坦阅读结构，不让嵌套对话不断向右缩排。
- 留言保存 `page_path`，管理页可直接看出留言所属文章、根留言与实际回复目标；作者回复也会沿用同一文章与 thread 脉络。

### 资料、部署与验证

- 新增并正式套用 `0002_comment_lifecycle.sql` D1 migration，补上直接回复、文章路径与管理员移除标记；既有回复资料也依旧版 `parent_id` 补上兼容的直接回复目标。
- Worker runtime tests 涵盖读者→作者→读者→作者的多轮回复、隐藏／恢复、撤回、永久删除与 tombstone 保留；正式 Worker 亦以 exact-current-main 部署，并通过 `/api/comments/v1/health` 验证 production source lineage。
- GitHub Pages、跨浏览器留言／管理界面验证与 production live-reader QA 均再次通过；本轮没有修改 Notion 内容模型或文章资料。

## 2026-09-10｜长文阅读、文章框架与发布治理完成一轮收敛

### 长文阅读与中文排版

- 重新整理桌面文章阅读布局，将正文与右侧目录收敛为更稳定的双栏结构；作者信息、分享、上一篇／下一篇、相关文章与留言移入独立读后区，维持一致版心，但不再延长正文的 sticky TOC 阅读阶段。
- 修正文章目录原本“CSS 看似 sticky、实际滚动却无法稳定固定”的问题，将 sticky 行为移到真正的 sidebar 容器，并重新接回 Blowfish 原生 `.toc` 与 Smart TOC 行为。
- 1024–1279px 维持文章上方的可折叠目录；1280px 以上才使用右侧 sticky TOC，避免中型屏幕被目录挤压。
- 桌面 TOC 降低字号与一般项目的视觉权重；当前阅读中的章节以低调方式加强辨识，不额外建立第二套 scroll-spy。
- 阅读时间达 8 分钟以上的文章加入 2px 阅读进度线；进度只计算正文 `.article-main`，不把作者卡、分享、相关文章、留言与 footer 算入，因此读完正文时即到达 100%。
- H2／H3 增加有节制的垂直留白，让长文章在章节转换时有较自然的呼吸节奏。
- 文章 H1／H2／H3 使用 balanced wrapping，降低窄屏幕上中文标题出现孤字或过短尾行的概率。
- zh-TW／zh-CN 文章正文加入较严格的 CJK 换行处理，同时保留既有 overflow safety；不为追求“日系感”加入额外正文字距或全文两端对齐。
- 实际浏览器量测确认目前正文约为 16px 字号、28px 行高、约 42 个 CJK em／行，因此保留现有正文宽度与密度，不再凭 `80ch` 单位推测中文字行过宽。

### 导航、回到顶部与页尾

- 繁体／简体、桌面／手机的主菜单移除与左上角 `HUIKAI` 品牌链接功能重复的“首页”；`HUIKAI` 维持各语言首页的持续入口，主导航只保留真正不同的目的地。
- “回到顶部”由固定贴着 viewport 的位置改成阅读版心感知配置：手机维持传统右下角，中型屏幕保留安全边距；宽屏幕有 TOC 时依完整阅读布局右缘定位，没有 TOC 的文章则依正文 `.article-reading-content` 右缘定位，不再退回视窗最右侧。
- 非文章页仍保留 viewport fallback，避免把文章版心逻辑错套到一般页面。
- 按钮延后到滚动约两个 viewport 后才出现，降低阅读初段干扰；接近 footer 时会自动上移，不遮住页尾信息。
- 隐藏状态同步退出键盘焦点与 pointer interaction，并保留 44×44px 点击范围与可见 focus 状态。
- 页尾 Hugo／Blowfish 技术 attribution 保留，但缩小到较低视觉层级，避免与 copyright 及正文竞争注意力。
- 新增繁简、桌机首页入口与有／无 TOC 的回到顶部浏览器回归，让这些读者路径不只依 CSS 静态判断。

### 文章信息与阅读框架

- 将 Notion `last_edited_time` 正式投影为 Hugo `lastmod`，文章可以区分“发表”与真正有意义的“更新”。
- 文章形式与成熟度改以较自然的读者语言呈现；作者区由较强烈的卡片感收敛成较安静的 editorial footer。
- 新增繁体／简体 `/now/` 页面作为“目前正在关心与进行什么”的轻量入口，但不塞入主要导航。
- About 加入较精简的入口层，同时保留“澄心之游”完整脉络；简体 About 也同步到同一套核心内容，并加入繁简一致性验收。
- 修正桌面搜索控制项的尺寸与内容容纳问题，恢复较符合 Blowfish 原生行为的呈现。

### Notion 内容治理与翻译 staging

- 将 Notion 旧 `Text` 字段整理为 `Source`，新增 `Source URL`，让来源名称与网址可以成对管理；既有来源资料保留。
- 将内容与翻译支持语言收敛到网站实际提供的 `zh-TW`／`zh-CN`，避免资料模型宣告网站尚未真正支持的语言。
- 重新整理翻译工作视图与发布检查，使真正的翻译页面、Test staging 与 Public 发布状态更容易区分。
- 完成来源追溯、Translation Group、Translation Source Revision、Translation Engine 等翻译治理契约；原文仍可在 Test 阶段准备翻译草稿，不必先公开。
- 翻译流程缺少 OpenAI API key 时会安全退回 preflight，只产生检查结果，不建立不完整草稿。

### 留言、发布流程与验证

- 正式留言由 Giscus 切换到 HUIKAI 自有的免账号留言服务；既有 Giscus 保留为可验证的 rollback 路径，而不是同时在 production 载入两套留言系统。
- 将留言与读后导航正式拆出正文／TOC 阅读网格，让 sticky TOC 随正文结束；留言表单同步收敛高度、空状态、Turnstile 显示、字段语义与状态处理，降低读完正文后的视觉竞争。
- 补齐留言区有留言、0 条留言、载入失败、桌面／手机、亮／暗模式与窄宽 Turnstile 等回归，并修正专项截图保存与 production live-reader QA 的结构判断，使候选版与正式站使用同一套读后区边界。
- 将纯程序／CSS／模板的 code-only release 与 Notion publication health 适度解耦，避免某一篇 Notion 内容资料异常时，连无关的前端修正都无法发布。
- Notion publication health 改由只读流程检查；真正同步仍维持 fail-closed，且 exact-current-main／exact-SHA 部署边界保留。
- 重要读者行为不再只检查 CSS 或 build 是否成功，而是由 Playwright 实际操作与量测。
- production reader QA 已涵盖 TOC responsive／sticky、长文阅读进度、CJK 排版、首页入口、回到顶部定位、留言区与 footer 避让等行为。
- 本日整合后的正式 `main` 以 exact commit 构建与 GitHub Pages 发布；部署后亦以 `source-commit.txt` 核对 production 实际提供的来源版本。

## 2026-09-09｜首页定位、多语言与内容探索重新整理

### 首页与品牌层级

- 将网站核心由较分散的领域式自我介绍收敛为 **HUIKAI／澄心之游**，首页主文案确立为“记录那些值得长期保留的价值。”
- 首页保留“游而澄心：在所见、所学、所历之间，让杂质慢慢沉下，留下值得回望的自己与价值。”作为较低调的精神补充，不再用更多口号与领域清单增加首页负担。
- 首页 CTA 层级重新整理：“阅读文章”作为主要入口，“浏览项目”与“关于我”退为次要入口。
- 首页与 About 的繁体／简体 site metadata、品牌文字及回归验收同步对齐“澄心之游”。
- 一般文章／探索列表默认改采较安静的 editorial list 呈现；Projects 因需要辨识独立成果，仍保留卡片形式。
- 相关文章由 5 篇缩减为 3 篇，降低文章读完后的信息密度。

### Projects 与外部平台角色

- AFP 正式成为 Projects 中的一级项目，而不是只挂在 About 里作身份补充。
- Devpost 被重新定位为比赛／提交活动的外部佐证，不再作为主要 Projects 入口，也不让外部平台取代 HUIKAI 作为 canonical project surface。
- Nutrient Hackathon 的旧项目网址保留作历史 case bridge，但不再与长期项目卡片并列；相关比赛经验回到文章与历史脉络中阅读。
- Projects 因此更明确地用来保存具有独立成果、系统或生命周期的长期实践，而不是把每一次参赛记录都视为正式项目。

### 多语言阅读与 taxonomy

- 修正繁体／简体文章同 slug 时的 canonical route ownership，避免非默认语言的旧 alias 覆盖真正的繁体 canonical page。
- ambiguous legacy root 改为 fail closed，不再任意挑一个语言版本；build 后会再次检查 canonical URL、language、redirect 与 `noindex` 状态。
- 完成繁简文章的 `hreflang`／canonical 验证，只有真正存在的翻译 counterpart 才会对外宣告。
- 保留既有 taxonomy identity／历史 URL，同时让简体读者看到对应的简体 Category／Tag 名称，不为翻译显示而破坏原有网址。
- 新增实际文章级语言切换 QA，直接验证 zh-CN → 繁体 → zh-TW → 简体 → zh-CN 的往返，以及 `html lang`、canonical 与无 meta-refresh 行为。
- 翻译模型的付费 apply 行为改为明确的手动操作；自动流程主要负责 preflight／观测，避免同步事件意外建立翻译草稿或产生模型费用。

### 工程可靠性

- GitHub Actions 的外部 action reference 固定到完整 immutable SHA，并加入验证，避免日后重新出现浮动 tag／branch 依赖。
- 建立每周 Chromium、Firefox、WebKit 跨浏览器读者质量检查，涵盖代表性 responsive 页面、亮／暗模式、键盘操作、基本 target size 与 WCAG A／AA axe 检查。
- 多语言路由、Projects 版面与首页／列表调整也纳入实际 render 与浏览器回归，而不只依赖 Hugo build。

## 2026-09-08｜网站系统整合阶段完成

### 已完成

- 完成 Notion → Hugo → Blowfish → GitHub Pages 正式内容发布链路。
- 完成 Notion `Published + Public` 发布契约与 Test／Public 内容隔离。
- 完成增量同步、删除隔离、候选快照验证与 exact-SHA deployment。
- 完成首页内容选择／轮替与 Notion `Home` 字段治理。
- 完成文章 Category、Type、Tag、Explore 与站内搜索入口。
- 完成 zh-TW／zh-CN 语言路由、旧网址 alias 与翻译治理基础。
- 完成 Social Preview／Open Graph 与文章社群分享。
- 完成文章 Hero cover 与 Social Preview 图片来源分离；Hero 可保留 SVG，社群预览仍维持 1200×630 raster 契约。
- 完成既有 Tag URL identity 保留与语言别显示名称；正体站可显示正体名称，同时不破坏历史 taxonomy URL。
- 完成 Giscus 留言，并让留言主题同步网站亮／暗模式。
- 完成 Notion 图片、封面、媒体容量与文件预算治理。
- 完成 Notion Audio Gateway；正式页面可播放并支持 Range request。
- 完成 Notion Video Gateway；正式页面 MP4 可播放、seek，并支持 Range request。
- 完成公开文章的 comments policy、media source contract 与 rendered-site verification。
- 完成 Notion 作者工作 Views：写作工作台、已发布、测试内容、翻译工作、发布检查。

## 从 Git 回溯的早期历史

- 2026-09-08 以前的建站阶段当时尚未整理进本站“网站记录”。以下依 repository 的 commit 时间、信息与实际变更回溯重建，只保留可确认的主要里程碑；重复的自动同步与一般小修补不逐笔抄录。

### 2025-07-31｜Notion 同步开始留下可追溯版本

- 至少自 2025-07-31 起，Git 历史已持续出现由自动流程写入的 `🔄 Sync from Notion` commits，显示内容工作流已从纯手动 Hugo 文件逐步转向 Notion 驱动。
- 这些同步记录后续延续到 2026 年，成为现在 Notion → Hugo 发布系统的前身；这里只保留阶段性里程碑，不把每次同步当成一笔网站大事。

### 2025-07-06–07｜自动构建与部署开始成形

- 2025-07-06 的 Git 记录加入 `hugo.yml`，GitHub Actions 开始承担 Hugo 网站的自动构建／发布工作。
- 2025-07-07 清理最初的 Blowfish submodule／bootstrap 残留；同日亦留下 `trigger new Cloudflare deployment` 的 commit，显示早期已在调整部署与托管方式。
- 当时架构仍在试验，不能用今天的 exact-SHA、Notion publication contract 与 production QA 标准倒推早期系统已具备同等治理。

### 2025-07-05｜Hugo／Blowfish 网站起点

- GitHub repository 建立于 2025-07-05；目前 Git 历史的 root commit 为 `4c4bace`（`Vendor bootstrap theme`），是可追溯的网站程序起点。
- 初始版本已采用 Hugo + Blowfish；最早的 `hugo.toml` 使用 `https://huikai79.com.kg/`，默认内容语言仍是 English，之后才逐步演变为今天以繁体中文为主、支持简体中文的 HUIKAI。
- 这一阶段主要建立可运行的静态网站骨架；后来的 Notion CMS、多语言、媒体 gateway、Reader QA 与发布治理，都是在这个基础上逐步形成。

## 待条件成熟再评估

- Managed media 接近现有 100 MiB 管理预算，或大型影音需求明显增加时：重新评估 Cloudflare R2／object storage。
- 正式文章约达 30–50 篇时：重新检查 Category／Tag 的 canonical taxonomy 与命名治理。
- 翻译文章约达 10 篇以上，或来源文章开始频繁修订时：评估自动 translation refresh、Stale 状态写回与人工重审策略；目前已能用 Source Revision／Config Fingerprint 辨认 stale 信号，但不自动覆盖既有翻译。
- 正式内容约达 50 篇以上，或读者开始难以找到旧内容时：重新评估搜索排序、推荐与相关文章策略。
- 垃圾信息、滥用或通知需求明显增加时：再评估 spam moderation、通知与更进阶的社群管理；不因文章管理需求已成熟而一并扩大功能。
- 同步／构建时间持续明显上升时：再评估 cache、图片处理与 pipeline 性能优化；目前不为预期中的未来规模提前增加复杂度。

## 下次可完善

- 补齐翻译 Draft 对 Notion-hosted／file-upload 图片的 durable-media contract；目前《如何让一个想法生长》zh-CN 因此安全阻挡，不应以复制短效 signed URL 绕过。
- 取得 Umami Website ID 后再正式启用 Analytics，并以真实读者数据决定后续 UX 调整；在此之前不把 Analytics 记为已启用。
- 逐步压缩仍超过 media warning threshold 的旧封面，降低 repository 与 build 的媒体负担。
- 逐篇决定哪些 Test 内容值得修订后转成正式文章，不批次公开。
- 当主要版面、内容模型或读者路径再次有明显变动时，除既有自动化 QA 外，再做一次人工的桌面／手机、亮／暗模式与主要浏览器视觉巡检。