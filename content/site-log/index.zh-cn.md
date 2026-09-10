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

## 2026-09-10｜长文阅读、文章框架与发布治理完成一轮收敛

### 长文阅读与中文排版

- 重新整理桌面文章阅读布局，将正文与右侧目录收敛为更稳定的双栏结构；作者信息、分享、上一篇／下一篇、相关文章与留言维持和正文阅读区对齐。
- 修正文章目录原本“CSS 看似 sticky、实际滚动却无法稳定固定”的问题，将 sticky 行为移到真正的 sidebar 容器，并重新接回 Blowfish 原生 `.toc` 与 Smart TOC 行为。
- 1024–1279px 维持文章上方的可折叠目录；1280px 以上才使用右侧 sticky TOC，避免中型屏幕被目录挤压。
- 桌面 TOC 降低字号与一般项目的视觉权重；当前阅读中的章节以低调方式加强辨识，不额外建立第二套 scroll-spy。
- 阅读时间达 8 分钟以上的文章加入 2px 阅读进度线；进度只计算正文 `.article-main`，不把作者卡、分享、相关文章、留言与 footer 算入，因此读完正文时即到达 100%。
- H2／H3 增加有节制的垂直留白，让长文章在章节转换时有较自然的呼吸节奏。
- 文章 H1／H2／H3 使用 balanced wrapping，降低窄屏幕上中文标题出现孤字或过短尾行的概率。
- zh-TW／zh-CN 文章正文加入较严格的 CJK 换行处理，同时保留既有 overflow safety；不为追求“日系感”加入额外正文字距或全文两端对齐。
- 实际浏览器量测确认目前正文约为 16px 字号、28px 行高、约 42 个 CJK em／行，因此保留现有正文宽度与密度，不再凭 `80ch` 单位推测中文字行过宽。

### 回到顶部与页尾

- “回到顶部”由固定贴着 viewport 的位置改成阅读版心感知配置：手机维持传统右下角，中型屏幕保留安全边距，宽屏幕且有 TOC 时则依实际阅读布局右缘定位到外侧 gutter。
- 按钮延后到滚动约两个 viewport 后才出现，降低阅读初段干扰；接近 footer 时会自动上移，不遮住页尾信息。
- 隐藏状态同步退出键盘焦点与 pointer interaction，并保留 44×44px 点击范围与可见 focus 状态。
- 页尾 Hugo／Blowfish 技术 attribution 保留，但缩小到较低视觉层级，避免与 copyright 及正文竞争注意力。

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

### 发布流程与验证

- 将纯程序／CSS／模板的 code-only release 与 Notion publication health 适度解耦，避免某一篇 Notion 内容资料异常时，连无关的前端修正都无法发布。
- Notion publication health 改由只读流程检查；真正同步仍维持 fail-closed，且 exact-current-main／exact-SHA 部署边界保留。
- 重要读者行为不再只检查 CSS 或 build 是否成功，而是由 Playwright 实际操作与量测。
- production reader QA 已涵盖 TOC responsive／sticky、长文阅读进度、CJK 排版、回到顶部定位与 footer 避让等行为。
- 本日整合后的正式 `main` 已完成 exact commit 构建、GitHub Pages 部署与 production live reader QA。

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

## 待条件成熟再评估

- Managed media 接近现有 100 MiB 管理预算，或大型影音需求明显增加时：重新评估 Cloudflare R2／object storage。
- 正式文章约达 30–50 篇时：重新检查 Category／Tag 的 canonical taxonomy 与命名治理。
- 翻译文章约达 10 篇以上，或来源文章开始频繁修订时：评估自动 stale detection 与 translation refresh。
- 正式内容约达 50 篇以上，或读者开始难以找到旧内容时：重新评估搜索排序、推荐与相关文章策略。
- 留言量、垃圾信息或管理负担明显增加时：重新评估 moderation、通知与社群管理流程。
- 同步／构建时间持续明显上升时：再评估 cache、图片处理与 pipeline 性能优化；目前不为预期中的未来规模提前增加复杂度。

## 下次可完善

- 取得 Umami Website ID 后再正式启用 Analytics，并以真实读者数据决定后续 UX 调整；在此之前不把 Analytics 记为已启用。
- 逐步压缩仍超过 media warning threshold 的旧封面，降低 repository 与 build 的媒体负担。
- 逐篇决定哪些 Test 内容值得修订后转成正式文章，不批次公开。
- 当主要版面、内容模型或读者路径再次有明显变动时，除既有自动化 QA 外，再做一次人工的桌面／手机、亮／暗模式与主要浏览器视觉巡检。
