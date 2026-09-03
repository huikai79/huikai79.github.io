---
title: "參加 Nutrient Hackathon 後，我重新理解了「做作品」與「參加比賽」的差別"
date: "2026-09-04"
slug: "first-Hackathon"
description: "最近我參加了 DevNetwork [API + Cloud + AI] Hackathon 2026 裡的 Nutrient DWS Challenge 。 這不是我第一次做 AI 相關專案，但這次的經驗讓我第一次很明確地感受到： 把一個東西做出來，和把它變成一件適合參賽、可以被驗證、又不會把自己…"
tags: ["技术学习"]
---
# 


最近我參加了 DevNetwork [API + Cloud + AI] Hackathon 2026 裡的 **Nutrient DWS Challenge**。


這不是我第一次做 AI 相關專案，但這次的經驗讓我第一次很明確地感受到：


**把一個東西做出來，和把它變成一件適合參賽、可以被驗證、又不會把自己的核心價值全部公開出去的作品，其實是三件不同的事。**


這場比賽最後留給我的，已經不只是某一個作品。


它反而改變了我之後參加 Hackathon 的方法。


---


## 一開始，我以為這是一場「把 API 接起來」的比賽


Nutrient 的題目很直接：


企業每天都在處理合約、表單、發票、身分文件、報告等文件，但在法規、稽核或高風險工作裡，「大概正確」是不夠的。


主辦方希望參賽者使用 Nutrient DWS，把雜亂的文件轉成真正可以被信任、檢查與追蹤的工作流程。


而且有一個很重要的要求：


**Nutrient DWS 必須真的參與至少一個核心文件操作，不能只是為了符合比賽規則而象徵性呼叫一次 API。**


官方也很明白地暗示了他們想看的方向：


AI 可以做大量工作，但在不能猜的地方，要讓人介入；而整個過程最好可以留下可以重播、追查與稽核的紀錄。


提交本身也很典型 Hackathon：


專案名稱與一句話介紹、Repo 或分享連結、安裝說明，以及一支 2～4 分鐘、能看見端到端流程實際運作的 Demo。


一開始看起來，就是典型的：


「找問題 → 接 API → 做介面 → 錄 Demo → Submit。」


但實際做下去之後，我發現真正困難的地方完全不在這裡。


---


## 第一個問題：API 能跑，不代表作品成立


接上 Nutrient DWS 並不是最難的部分。


真正的問題是：


**如果把 Nutrient 拿掉，這個作品是不是幾乎完全一樣？**


如果答案是「是」，那表示 Sponsor integration 很可能只是裝飾。


所以我開始不再問：


「我有沒有用 Nutrient？」


而是問：


「Nutrient 在整個因果鏈裡，究竟完成了什麼不可忽略的工作？」


例如：


文件進來之後，Nutrient 負責抽取內容、保留來源位置、建立可以回到原文件驗證的證據。


接下來系統才能判斷：


哪些資訊足夠明確？


哪些地方需要人確認？


最後又是根據什麼證據產生結果？


這時候 API 才不只是 API。


它變成整個產品可信度的一部分。


這也是我後來很重視的一條原則：


**Sponsor 技術不需要是全世界唯一能做到這件事的工具，但它必須對作品產生真實、可見、可以驗證的貢獻。**


---


## 第二個問題：功能存在，不代表評審看得到


做專案的人，很容易有一種錯覺。


因為自己知道整個系統怎麼運作，所以會覺得：


「這個功能不是很明顯嗎？」


其實完全不是。


評審看到的是幾分鐘的影片、一個 Submission Page、一份 README，可能再加幾張 Screenshot。


他們沒有參與開發，也不知道我們腦中的架構。


於是我開始把 Demo 想成另一種產品。


它不是「產品介紹影片」，而是一條證據路徑。


我後來比較認同的結構是：


Problem


↓


Real Input


↓


Sponsor Technology


↓


Observable Evidence


↓


Human Action


↓


Observable State Change


↓


Result


↓


Scope Boundary


也就是說：


不要先花兩分鐘解釋 Architecture。


先讓人看到事情真的發生。


文件真的進來。


Nutrient 真的處理了它。


來源真的能找到。


人真的可以介入。


介入之後狀態真的改變。


最後再說這件事為什麼重要。


這件事也讓我重新理解「展示」。


好的 Demo 不是把作品講得很厲害。


而是讓重要主張旁邊直接出現證據。


---


## 第三個問題，也是這次最意外的問題：到底應該公開多少？


這反而成為整場比賽對我影響最大的一件事。


Hackathon 很鼓勵大家展示：


程式碼、GitHub、Architecture、流程、測試、Demo、README。


工程師也很自然會覺得：


「公開越多，技術可信度越高。」


但是做到某個階段，我開始發現另一個風險。


假設單獨看：


README 沒問題。


Demo 沒問題。


Schema 沒問題。


Tests 好像也沒問題。


Architecture Diagram 也沒有完整 source code。


可是如果把：


README


＋ Demo


＋字幕


＋ Schema


＋測試名稱


＋ UI State


＋ Architecture Diagram


全部拼起來呢？


一個熟悉這個領域的工程師，有沒有可能把核心機制反推出來？


這讓我第一次真正理解：


**保護技術，不能只靠「Source Code 不公開」。**


產品的 state 名稱、欄位名稱、測試案例、錯誤訊息、UI 關係、流程圖，全部可能洩漏 Architecture。


所以我後來開始把公開內容分成幾個層次。


有些東西可以大方證明：


Nutrient API 的真實整合、Synthetic Demo Data、來源頁面、文件 highlight、human review、基本錯誤處理、產品限制。


有些東西可以展示「發生了什麼」，但不一定需要解釋完整的「為什麼會這樣發生」。


例如可以讓人看到：


HUMAN REVIEW


PROCEED


BLOCKED


卻不一定需要把所有 transition conditions、priority rules、authority logic 全部公開。


至於真正構成長期競爭力的東西，例如：


核心決策邏輯、狀態轉移規則、搜尋與最佳化方法、完整 adversarial tests、內部 policy、未來 architecture，


就需要另外做公開決策。


這後來變成我很喜歡的一句話：


**Open the proof. Protect the recipe. Audit the combination.**


中文就是：


**公開證明，保護配方，審核組合。**


這套思考後來也正式被我整理成參加其他競賽時使用的 Disclosure / IP 控制方法。


---


## 我也因此改變了 GitHub 的使用方式


以前很自然的做法可能是：


Private Repo


↓


做完


↓


刪掉不想公開的東西


↓


改成 Public


現在我會更傾向：


Private Development Repo


↓


Disclosure Review


↓


Clean Export


↓


Sanitized Submission Repo


也就是：


母體繼續完整保存。


比賽需要什麼，再建立一份適合 Submission 的乾淨版本。


因為真正需要保護的，不一定只是一兩個檔案。


Git history、測試、schema、fixtures、internal identifier，甚至 README 的敘述，都可能彼此拼出原本不打算公開的東西。


而且比賽結束，也不代表所有東西就應該立刻 Open Source。


比賽之後還可以重新決定：


哪些適合公開？


哪些適合繼續開發？


哪些可能有商業價值？


哪些需要進一步處理智慧財產問題？


這對我來說，是這次比賽非常重要的一課。


---


## 回頭看，我得到的並不只是一個 Hackathon Project


如果只看表面，Nutrient Challenge 是一場文件 AI 的 Sponsor Challenge。


但對我而言，它實際測試了更多東西：


我能不能找到真正適合 Sponsor 技術的問題？


能不能把 API 從「有使用」變成「有必要存在」？


能不能把一個 AI 系統的能力變成可以被評審驗證的證據？


能不能在幾分鐘內讓沒有參與開發的人理解它？


能不能誠實區分：


已完成的功能、真正測過的結果、Demo Data、估算，以及還只是 Roadmap 的東西？


更重要的是：


**我能不能在想贏得比賽的同時，還記得保護比賽之後的自己？**


這一題，我以前其實沒有認真想過。


---


## 這次最大的收穫，不一定要等比賽結果才知道


Hackathon 很容易讓人把成功定義成：


有沒有得獎。


但現在我比較願意把每一場比賽看成一次高壓測試。


它會逼你在有限時間裡回答很多平常可以逃避的問題：


這個問題真的值得解嗎？


你的技術真的有差異嗎？


API 真的在工作嗎？


作品真的能重跑嗎？


評審真的找得到證據嗎？


公開出去的東西，會不會讓你之後後悔？


哪些功能其實根本不值得做？


這些問題的答案，就算最後沒有變成獎項，也會留下來。


Nutrient 這一輪對我最大的影響，就是讓我開始把「參加比賽」從一次性的作品製作，慢慢變成一套可以重複使用的工程與決策流程。


所以如果有人問我：


「這次 Nutrient 比賽你做了什麼？」


我現在可能不只會回答那個 Project 做了什麼。


我更想回答：


**這場比賽讓我第一次建立了一套方法，去思考什麼應該做、什麼必須證明、什麼可以公開，以及什麼值得保留下來。**


對我來說，這可能比單純多做一個 Demo 更有價值。

