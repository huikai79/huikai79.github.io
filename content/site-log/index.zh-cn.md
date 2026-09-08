---
title: "网站记录"
layout: "simple"
description: "记录本站各阶段完成的重要功能、延后决策与待完善事项。"
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

- 本页只记录网站里程碑、条件成熟后再评估事项与下一轮可完善处；一般小修补不逐项记录。

## 2026-09-08｜网站系统整合阶段完成

### 已完成

- 完成 Notion → Hugo → Blowfish → GitHub Pages 正式内容发布链路。
- 完成 Notion `Published + Public` 发布契约与 Test／Public 内容隔离。
- 完成增量同步、删除隔离、候选快照验证与 exact-SHA deployment。
- 完成首页内容选择／轮替与 Notion `Home` 字段治理。
- 完成文章 Category、Type、Tag、Explore 与站内搜索入口。
- 完成 zh-TW／zh-CN 语言路由、旧网址 alias 与翻译治理基础。
- 完成 Social Preview／Open Graph 与文章社群分享。
- 完成 Giscus 留言，并让留言主题同步网站亮／暗模式。
- 完成 Notion 图片、封面、媒体容量与文件预算治理。
- 完成 Notion Audio Gateway；正式页面可播放并支持 Range request。
- 完成 Notion Video Gateway；正式页面 MP4 可播放、seek，并支持 Range request。
- 完成公开文章的 comments policy、media source contract 与 rendered-site verification。
- 完成 Notion 作者工作 Views：写作工作台、已发布、测试内容、翻译工作、发布检查。
- 完成 Umami Analytics 的非启用预备设置；尚未填入 Website ID，因此目前不追踪访客。

### 待条件成熟再评估

- Managed media 接近现有 100 MiB 管理预算，或大型影音需求明显增加时：重新评估 Cloudflare R2／object storage。
- 正式文章约达 30–50 篇时：重新检查 Category／Tag 的 canonical taxonomy 与命名治理。
- 翻译文章约达 10 篇以上，或来源文章开始频繁修订时：评估自动 stale detection 与 translation refresh。
- 正式内容约达 50 篇以上，或读者开始难以找到旧内容时：重新评估搜索排序、推荐与相关文章策略。
- 留言量、垃圾信息或管理负担明显增加时：评估 moderation、通知与社群管理流程。
- 同步／构建时间持续明显上升时：再评估 cache、图片处理与 pipeline 性能优化；目前不为预期中的未来规模提前增加复杂度。

### 下次可完善

- 取得 Umami Website ID 后正式启用 Analytics，再以真实读者数据决定后续 UX 调整。
- 压缩目前超过 media warning threshold 的旧封面，降低 repository 与 build 的媒体负担。
- 整理 legacy 简体 Tag 与未来 canonical taxonomy 的显示名称／URL 策略。
- 逐篇决定哪些 Test 内容值得修订后转成正式文章，不批次公开。
- 进一步分离文章 Hero cover 与 1200×630 Social Preview 图片来源，让 SVG／raster 使用情境更清楚。
- 随正式内容增加，定期做一次桌面／手机、亮／暗模式与主要浏览器的读者端回归检查。
