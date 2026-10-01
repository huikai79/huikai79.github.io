---
title: "Brick Breaker｜我的 Vibe Coding 打磚塊實驗"
description: "2025 年底做的一個小型 Web 遊戲：用自然語言、規則與系統邊界，把一個打磚塊點子一路做成可以實際遊玩的作品。"
layout: "simple"
weight: 40
showBreadcrumbs: false
showDate: false
showReadingTime: false
---

**狀態：** 已完成 · 2025 年底 · Vibe Coding 實驗

[查看 GitHub 原始碼](https://github.com/chinggpt2025/brick-breaker)

## 一個很小，但真的做完的專案

這是我在 2025 年底做的打磚塊遊戲，也是我早期實際嘗試 **Vibe Coding** 的作品之一。

當時我沒有把重點放在「先學會多少 JavaScript」，而是反過來從自己想要的遊戲規則、狀態和功能開始，再讓 AI 協助把它逐步實作出來。

所以我現在把它留在 Projects，不是因為它是一個多大的產品，而是因為它很直接地記錄了一個階段：

**我開始嘗試用自然語言與系統思維，把腦中的想法做成真的可以操作的東西。**

## 最後做成了什麼

它是一個以 **Vanilla JavaScript + HTML5 Canvas** 製作的 Arkanoid／Breakout 類型 Web 遊戲。

repository 目前保留的版本包含 28 個關卡，每 7 關有一個 Boss，也加入多種 power-up、combo、成就、每日挑戰與排行榜等機制。

除了基本遊戲循環，我當時還一路加進：

- 桌面鍵盤／滑鼠與行動裝置觸控操作；
- Boss 與特殊磚塊；
- 多種 buff／debuff 與道具效果；
- Daily／Weekly／All-Time 排行榜；
- LocalStorage 本地紀錄；
- PWA 與離線支援；
- 粒子、震動、光效與音效；
- 成就、分享與遊戲設定。

從現在回頭看，它已經不只是最初那個「打一顆球、消掉磚塊」的小練習，而是慢慢長成一個有不少狀態彼此作用的完整小遊戲。

## 我當時真正想試的是什麼

這個專案的 README 把它稱為一個「中等複雜度的 Vibe Coding 實驗」。

對我來說，比功能數量更重要的是另一件事：

**沒有傳統程式訓練背景，能不能仍然把一個開始變複雜的作品控制住？**

所以 repository 裡除了程式，也留下了 `system.md`、`data.md`、`api.md`、`ui.md` 等文件。

我當時嘗試先把系統拆開來想：

規則是什麼？

有哪些狀態？

資料怎麼流？

介面應該做什麼？

哪些東西改了之後，不應該把其他部分一起弄壞？

現在看來，這些做法還很早期，但它已經開始出現我後來反覆在其他專案裡使用的習慣：**先把邊界說清楚，再讓 AI 執行。**

## 為什麼現在把它留下來

Brick Breaker 並不是我現在最主要的工程專案，我也不打算把它包裝成仍在積極發展的產品。

但 Projects 如果只留下後來比較成熟的系統，反而會失去一部分過程。

這個小遊戲保存的是另一種東西：

**第一次發現「我好像真的可以把一個想法做出來」的階段。**

後來我做網站、AI Agent、VT-COS、悟之一手，以及其他需要處理狀態、邊界與驗證的東西時，方法已經變得更嚴格；但這個遊戲可以讓我回頭看見，那些習慣最初還很粗糙時是什麼樣子。

所以我想把它留下來。

不是因為它已經完美，而是因為它確實是我走過的一小段。

## 技術與範圍

目前 repository 顯示主要實作為 JavaScript，前端使用 HTML5 Canvas，並包含 Service Worker／manifest 的 PWA 結構；排行榜與訪客相關功能則使用 Supabase client。

這個 Project 頁只記錄公開 repository 目前能確認的作品範圍，不把它延伸描述成仍在維護的正式遊戲服務。

[前往 Brick Breaker GitHub repository](https://github.com/chinggpt2025/brick-breaker)
