---
title: "Notion → Hugo 网站发布系统"
description: "把 Notion 内容同步为 Hugo 页面，并通过 Blowfish 与 GitHub Actions 完成可验证发布。"
layout: "simple"
weight: 10
showBreadcrumbs: false
---

这是这个网站持续维护的发布系统，也是一个长期工程项目。

它把 **Notion** 作为主要内容来源，经过同步与本地化处理后交给 **Hugo + Blowfish** 生成静态网站，再由 **GitHub Actions** 负责验证与部署。

目前已经包含：

- Notion 文章同步与 bundle manifest。
- 临时媒体本地化，避免页面依赖会过期的远端资源。
- 自动封面解析：优先使用明确封面，其次使用内文首图，最后使用确定性的程序化 fallback。
- 技术文章限定评论策略。
- 1200×630 Open Graph / Twitter Social Preview。
- candidate validation 与 exact-SHA GitHub Pages deployment，避免未验证或过期 commit 被发布。

这套系统的重点不是增加更多依赖，而是让一般内容维护尽量留在 Notion，同时让网站构建结果可重复、可检查、容易恢复。

[查看网站源码](https://github.com/huikai79/huikai79.github.io/)
