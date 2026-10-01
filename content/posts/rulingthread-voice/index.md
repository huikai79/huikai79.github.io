---
title: "RulingThread Voice：同一個批准，為什麼現在不能執行？"
date: "2026-09-30"
slug: "rulingthread-voice"
description: "完成 AssemblyAI Voice Agent Hackathon 後，我用同一個語音請求與同一個 approval P002，測試 current authority state 如何在工具執行前改變結果：SUPERSEDED → HOLD，CURRENT → ALLOW。"
tags: ["AI", "Hackathon"]
showComments: true
commentKey: "notion:3ec7a59e-0439-8174-afb6-ef72ad2fc047"
categories: ["科技"]
entryType: "紀錄"
formats: ["紀錄"]
contentVisibility: "Public"
homePlacement: "None"
contentLanguage: "zh-TW"
translationKey: "rulingthread-voice"
images: ["social-preview.png"]
---

## 這次做了什麼


我完成了 **AssemblyAI Voice Agent Hackathon** 的作品 **RulingThread Voice — Current Authority Gate**。


這次真正想測的，不只是語音 Agent 能不能聽懂一句話，而是它在準備呼叫工具、產生現實效果以前，能不能再確認一件事：


> **這個曾經存在的批准，現在還有沒有治理這個動作的權力？**


公開作品：

- [Lablab submission](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/huikai-voice-lab/rulingthread-voice-current-authority-gate)
- [GitHub repository](https://github.com/huikai79/rulingthread-voice)

* * *


## 同一個要求、同一個批准，只改一個狀態


受控比較裡，我對兩個情境說完全相同的要求：


> “Release invoice INV-001 for $80 using approval P002.”


兩邊都使用同一個 `P002` approval、同一張 `INV-001`、同樣的金額與動作。


唯一改變的是 server 端掌握的 governing authority state。

- `P002 / SUPERSEDED` → `HOLD` → simulated effect `0 → 0`
- `P002 / CURRENT` → `ALLOW` → simulated effect `0 → 1`

所以這次 Demo 想留下的不是「AI 聽懂了，所以可以做」，而是：


**理解 request、找到 approval、擁有 current authority，是三件不同的事。**


* * *


## Voice 只負責把要求送到邊界


AssemblyAI 在這個 Demo 裡負責 live microphone audio、transcript、Voice Agent session、tool invocation，以及 tool result 回來之後的 spoken response。


但 Voice prompt 本身不決定 `HOLD` 或 `ALLOW`。


tool call 帶的是 business arguments；真正的 current-authority 判斷留在 backend，由 backend 在呼叫當下讀取 synthetic governing state。


這個分工對我很重要。


如果答案直接寫在 Voice prompt 裡，那只能證明模型照著提示說出了預期答案；它不能證明 action boundary 真的存在。


* * *


## 我刻意保留的真實邊界


這個作品使用的是 **synthetic demo data**。


`P002`、governing state 與 effect count 都是示範資料；`ALLOW` 產生的也只是 process-local simulated effect。


它不代表：

- 真實付款已發生；
- 真實 production authorization 已被驗證；
- 某個外部組織的權限系統已經接入；
- synthetic governing state 可以直接代表現實世界的 authority source。

公開 repository 也另外保留了 evidence、reproducibility、prior-work 與 rights disclosure，讓「這次真正測到什麼」和「沒有證明什麼」可以分開看。


* * *


## 這場 Hackathon 留下的東西


做完之後，我覺得這次最值得留下的其實是一條很簡單的問題：


**Agent 已經正確聽懂，也找到一個曾經有效的批准；接下來，它憑什麼認為自己現在仍然可以執行？**


我之前在其他專案裡已經一直碰到 evidence、human review、decision boundary 這些問題。這次只是把同一種治理問題推進到語音 Agent 與 tool call 的前一刻。


對我來說，Voice 不是新的治理答案。


它只是把那個原本就存在的問題變得更直接：


**當 AI 從「回答」走向「行動」，舊的批准不能只因為還找得到，就自動等於現在仍然有效。**


這是 RulingThread Voice 這次真正想留下的實驗。
