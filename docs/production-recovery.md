# Production recovery runbook

本文件記錄 HUIKAI 正式網站在 deployment 或 production live QA 異常時的最小回復流程。目的不是繞過現有 exact-SHA 保護，而是在失敗後清楚區分「已部署」「已驗證」與「需要回復」三種狀態。

## 目前發布邊界

- 正式 deployment 由 `.github/workflows/deploy.yml` 執行，必須以目前 `main` 的 exact SHA 進入。
- deployment 會把 `source-commit.txt` 一併發布，正式站 lineage 必須與要求的 SHA 相符。
- production live reader QA 在 GitHub Pages deployment 完成後執行，因此「workflow 最終失敗」不等於「deployment 沒有發生」。若失敗點在 live QA，先視為 production 已可能更新。
- 不以其他平台的 preview／build 狀態取代 GitHub Pages production lineage 判定。

## Live QA 失敗時

1. 先看 workflow job，確認失敗是在 build、deploy，還是 deploy 後的 live QA。
2. 若 deployment job 已成功，核對正式站 `source-commit.txt` 是否已等於本次 SHA。
3. 再判斷失敗屬於：
   - 真實讀者功能／版面 regression；
   - production-only 環境問題；
   - live QA selector／DOM contract 與已核准版面不同步；
   - 外部服務／快取問題。
4. 不因 QA 紅燈直接繼續疊加 CSS／template 修改；先找第一個與預期不同的證據。
5. 若網站實際可用、只有 QA contract 漂移，修 QA 並重新走正常驗證；若正式站確實退步，進入回復流程。

## 回復流程

現行 deploy guard 要求部署 SHA 必須是目前 `main` 的 exact SHA，因此不要把「直接重新部署舊 SHA」當作預設 rollback。

1. 找出造成 regression 的 main commit／merge commit。
2. 從目前 main 建立修復 branch。
3. 優先用 `git revert` 或等價的最小反向修改，產生新的候選 commit；不要改寫 main 歷史。
4. 跑與原變更相稱的 PR validation／build／render／reader QA。
5. 確認候選結果恢復原本正確行為後，再合併到 main。
6. 讓現有 main release／exact-SHA deployment 流程發布新的 revert SHA。
7. 最後核對：deployment run、`source-commit.txt`、正式頁面與相關 live QA 都對應新的 revert SHA。

## 不要混為同一件事的狀態

依序分開記錄：

`main 已更新` → `build 通過` → `deployment 完成` → `production lineage 已更新` → `正式讀者行為已驗證` → `外部平台快取已更新（若相關）`

前一階段成功不能自動證明後一階段成功。

## Cloudflare Pages 訊號

目前 Pull Request 仍可能收到 Cloudflare Pages 的 build／preview 訊號。若該 Cloudflare Pages project 已不承擔正式網站發布，應在 Cloudflare 端確認 domain、production branch 與實際用途後，再停用或解除該 GitHub Pages project integration，避免同一 PR 同時出現「正式 CI 通過」與「另一套 Pages build failed」的互相矛盾訊號。

停用前必須先確認它沒有承擔正式流量、必要 preview 或其他仍使用中的功能；不要只因 build 失敗訊息就直接刪除 project。

## 事故關閉條件

只有在以下條件成立後才把 production incident 視為已關閉：

- 正式站 lineage 對應預期 main SHA；
- 原本失敗案例已重跑通過；
- 鄰近主要讀者流程沒有新的 regression；
- 若修改的是 QA contract，實際網站行為也已獨立核對；
- 未解的外部快取、第三方服務或平台限制已明確標示。