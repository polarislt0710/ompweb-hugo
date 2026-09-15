---
name: gpt-image-2.5
displayName: "GPT Image 2.5 via Codex quota"
description: >
  Generate or edit images with ChatGPT Images 2.5 using the user's existing
  openai-codex (ChatGPT / Codex) login. Calls omp's built-in generate_image
  tool with provider openai-codex. Does NOT use RunComfy, OPENAI_API_KEY, or
  extra per-image billing. Triggers on "gpt image 2.5", "gpt-image-2.5",
  "ChatGPT Images 2.5", "flare", "sunburst", or any ask to generate/edit an
  image on Codex quota.
---

# GPT Image 2.5 — Codex / ChatGPT 額度

用已登入嘅 **openai-codex**（hugong / couplethings 嗰兩個 ChatGPT 計劃）。**禁止** `runcomfy run`、**禁止** OpenAI Platform `OPENAI_API_KEY`。

ChatGPT / Codex 產品而家出嘅係 Images 2.5。訂閱路徑**冇**得揀 API 名 `gpt-image-2.5-flare` / `sunburst`——嗰兩個係要另外俾錢嘅 Platform API。呢度就係訂閱出圖。

## 點樣出圖

開 `generate_image`，`provider` 固定 `openai-codex`。

文字出圖：

- `subject`：主體（必填，寫清楚）
- `action` / `scene` / `composition` / `lighting` / `style`：可選
- `text`：畫面入面要出現嘅字，短、逐字寫
- `aspect_ratio`：**只准** `1:1` | `3:4` | `4:3` | `9:16` | `16:9`
- `provider`: `openai-codex`
- **唔好傳 `image_size`。** 唔好傳 `3:2` / `2:3`。

`3:2` / `2:3` 係 xAI Grok Imagine 先支援。omp 嘅 `generate_image` 若見到呢兩個比例，會 **靜靜跳過 openai-codex**，改用 `xai` / `grok-imagine-image`，即使你寫咗 `provider: openai-codex`。用戶要 GPT Image 2.5 就等於失敗。要橫圖用 `16:9`，直圖用 `9:16`。

改圖：再加 `input`（本機路徑）同 `changes`（要改咩、要保留咩）。

畫面入面有字：`text` 欄寫原文，並加「sharp, legible, correctly spelled」。

## 唔好做

- 唔好 `runcomfy run openai/gpt-image-2.5/...`
- 唔好 `codex exec` 當 worker 出圖
- 唔好叫用戶再買 RunComfy credits
- 用戶無講要用付費 API，就唔好走 `openai`（API key）provider

## 失敗時

結果第一行若係 `Provider: xai` / `Model: grok-imagine-image`：**唔好當成功**。即刻用允許嘅 `aspect_ratio` 重試，仍然指定 `provider: openai-codex`。唔好繼續出其餘張。

若 `generate_image` 報未登入 / 無 image tool：叫用戶確認 OMP 已 `/login openai-codex`，並 **新開 session**（工具開關改完要重開）。仍然唔得先講，唔好自動改去 RunComfy。
