---
title: "RulingThread Voice｜現在仍有權執行嗎？"
description: "把 Voice Agent 的工具執行停在 current-authority gate 前：批准曾經有效，不代表現在仍然治理這個動作。"
layout: "simple"
weight: 30
showBreadcrumbs: false
showDate: false
showReadingTime: false
---

**狀態：** 公開實驗 · Voice Agent · 可重現 Demo

[查看 GitHub 原始碼](https://github.com/huikai79/rulingthread-voice) · [查看 Hackathon submission](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/huikai-voice-lab/rulingthread-voice-current-authority-gate) · [閱讀這次實驗紀錄](/posts/rulingthread-voice/)

## 從一句已經「有批准」的要求開始

RulingThread Voice 從一個很小的問題開始：

**如果 Agent 正確聽懂了要求，也找得到一個曾經有效的批准，它現在就可以執行嗎？**

在這個 Demo 裡，使用者對 Voice Agent 說：

> “Release invoice INV-001 for $80 using approval P002.”

兩次受控比較使用完全相同的 request、invoice、金額、action 與 approval。

唯一改變的是 server 端掌握的 governing authority state。

| Governing state | Backend result | Simulated effect |
| --- | --- | --- |
| `P002 / SUPERSEDED` | `HOLD` | `0 → 0` |
| `P002 / CURRENT` | `ALLOW` | `0 → 1` |

我想把「找到批准」和「批准現在仍然有效」拆成兩件不同的事。

## 這個專案在做什麼

RulingThread Voice 把一個 **current-authority gate** 放在 Voice Agent 準備產生工具效果的邊界。

AssemblyAI 負責 live microphone audio、transcript、Voice Agent session、tool invocation，以及 tool result 回來之後的 spoken response。

但 `HOLD` 或 `ALLOW` 不是寫死在 Voice prompt 裡。

Voice 只把 business arguments 帶到工具邊界；backend 才讀取 synthetic governing state，判斷這個 approval 在呼叫當下是否仍具有 current authority。

這個分工是整個實驗的重點：

**理解 request、找到 approval、擁有 current authority，不是同一件事。**

## 為什麼要保留成獨立專案

這個原型是在 AssemblyAI Voice Agent Hackathon 期間完成，但它要處理的問題並不只屬於一場比賽。

只要 Agent 開始從「回答」走向「行動」，就可能遇到同一類問題：

- 一個批准存在，不代表它現在仍有效；
- 一份舊紀錄可被找到，不代表它仍治理今天的動作；
- 模型理解了要求，不代表模型因此取得執行權；
- tool call 已經形成，也不代表 effect 應該立刻發生。

因此我把 Hackathon 留在「紀錄」文章裡，而把 RulingThread Voice 本身保留在 Projects，作為這個 action boundary 的公開實驗。

## 目前真正驗證到什麼

公開 snapshot 保留了受控比較、測試與 evidence。

目前可以重現的核心行為是：

- `P002 / SUPERSEDED` → `HOLD` → simulated effect 不增加；
- `P002 / CURRENT` → `ALLOW` → simulated effect 增加一次；
- 相同的語音要求不靠 Voice prompt 預先編碼兩個情境的答案；
- backend 在工具執行邊界讀取 governing state；
- 重複的成功操作不會再增加一次 simulated effect；
- 缺少可信、operation-specific receipt 時，結果保持 `UNKNOWN`，browser 不自動重試。

公開 repository 也提供不需要 AssemblyAI credential 的本地測試與 controlled comparison，讓核心 decision boundary 可以獨立重現。

## 真實邊界

這仍然是一個 Demo，不是 production authorization system。

approval records 與 governing state 都是 **synthetic demo data**；effect 是 **process-local simulated effect**。

因此目前不能由這個專案推出：

- 真實付款已經發生；
- 真實 production authorization source 已被驗證；
- synthetic governing state 可以直接代表現實世界的權限來源；
- Voice Agent 已經能安全處理所有具有現實後果的操作；
- current-authority gate 本身足以解決完整的授權、身份、稽核與復原問題。

這些邊界會和功能一起保留，避免 Demo 能做到的事情被寫成它尚未證明的能力。

## 與 VT-COS 的關係

current authority、decision boundary 與治理問題並不是在這次 Hackathon 才第一次出現。

底層的 VT-Workflow／VT-COS governance concepts 與部分 core implementation 早於 AssemblyAI Voice integration；這次比賽期間新增的是 Voice integration、同一個 `P002` 的 CURRENT／SUPERSEDED 受控比較，以及相應的 competition evidence。

所以我把 RulingThread Voice 看成一個比較具體的 vertical slice：

**把原本抽象的治理問題，推到 Agent 即將產生 action effect 的那一刻。**

它不是 VT-COS 的全部，也不代表 Voice 是新的治理答案；它只是讓其中一個問題變得可以被看見、操作與重現。

## 接下來

目前最值得繼續驗證的，不是增加更多 Voice 功能，而是把這條 boundary 放進更接近真實系統的條件：

- authority source 如何被可信地取得與更新；
- supersession、revocation 與 expiry 如何留下可追溯 lineage；
- effect receipt 如何和單一 operation 對應；
- timeout、UNKNOWN 與 retry policy 如何避免重複效果；
- human review 應該在哪些 action class 成為必要 gate。

如果這些條件沒有被處理好，再自然的語音互動也不會自動變成可信的行動系統。

[查看 RulingThread Voice repository](https://github.com/huikai79/rulingthread-voice)  
[閱讀 AssemblyAI Hackathon 實驗紀錄](/posts/rulingthread-voice/)
