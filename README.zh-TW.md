# ompweb

[![npm version](https://img.shields.io/npm/v/@kahme247/ompweb.svg?logo=npm&color=e05d44)](https://www.npmjs.com/package/@kahme247/ompweb)
[![node version](https://img.shields.io/node/v/@kahme247/ompweb.svg?logo=node.js&color=44cc11)](https://nodejs.org)
[![license](https://img.shields.io/github/license/kahme247/ompweb.svg?color=44cc11)](./LICENSE)
[![npm downloads](https://img.shields.io/npm/dm/@kahme247/ompweb.svg?color=44cc11)](https://www.npmjs.com/package/@kahme247/ompweb)
[![GitHub stars](https://img.shields.io/github/stars/kahme247/ompweb.svg?logo=github)](https://github.com/kahme247/ompweb/stargazers)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/kahme247/ompweb/pulls)

[English](./README.md) | [繁體中文](./README.zh-TW.md) | [簡體中文](./README.zh-CN.md) | [日本語](./README.ja.md)

社群：[加入 OMPWEB Discord](https://discord.gg/evqgGzRfM5)

[oh-my-pi (omp)](https://github.com/can1357/oh-my-pi) 程式設計智慧體的現代 Web UI。它讀取本機的 omp 會話，在瀏覽器中提供即時對話、專案會話瀏覽、設定管理和檔案預覽等功能。

![ompweb — 示範](docs/demo.gif)

<details>
<summary>截圖（淺色 / 深色主題）</summary>

![ompweb — 淺色主題](docs/screenshot-light.png)

![ompweb — 深色主題](docs/screenshot-dark.png)

</details>

## 環境要求

- 已安裝 [omp](https://github.com/can1357/oh-my-pi) 且在 `PATH` 中（或透過 `OMP_WEB_OMP_BIN` 指定路徑）
- Node.js `>= 22.19.0`

## 快速開始

**免安裝直接執行：**

```bash
npx @kahme247/ompweb@latest
```

**或全域性安裝：**

```bash
npm install -g @kahme247/ompweb
ompweb
```

在瀏覽器中開啟 [http://127.0.0.1:30177](http://127.0.0.1:30177)。

### CLI 選項

```bash
ompweb --port 8080                         # 自定義埠
ompweb --hostname 0.0.0.0                  # 監聽網路地址
ompweb --password "your-password"          # 啟用密碼保護
ompweb --no-open                           # 不自動開啟瀏覽器
```

## 功能特性

- **即時對話**：與本地 `omp` 智慧體進行低延遲流式互動。
- **會話管理**：按專案瀏覽歷史會話，支援會話分叉與分支回溯。
- **即時任務與子智慧體**：可摺疊面板即時展示任務清單（todo）與子智慧體進度，並支援檢視完整轉錄。
- **檔案管理與預覽**：與對話並排瀏覽檔案，支援程式碼、Markdown、圖片、音訊及 PDF 預覽。
- **Git Worktree 支援**：直接在側邊欄切換與管理 Git 工作樹。
- **視覺化設定**：在 Web 介面中直接配置模型、API 金鑰、MCP 伺服器、技能、外掛及 OMP 原生設定。
- **快捷指令與命令面板**：內建常用指令（`/plan`、`/review`、`/fix`、`/test` 等）及 `⌘K` / `Ctrl+K` 全域性面板。
- **主題與多語言**：溫暖紙感深淺主題，完整支援繁體中文、簡體中文、英語及日本語。

## 環境變數

| 變數 | 說明 | 預設值 |
| --- | --- | --- |
| `PORT` | 服務埠 | `30177` |
| `OMP_WEB_HOSTNAME` | 繫結主機名 | `127.0.0.1` |
| `OMP_WEB_PASSWORD` | 可選的 Web 訪問密碼 | _無（未啟用驗證）_ |
| `OMP_WEB_NO_OPEN` | 設為 `1` 時禁止自動開啟瀏覽器 | `0` |
| `OMP_WEB_OMP_BIN` | `omp` 二進位制路徑（未在 PATH 時使用） | _自動檢測_ |
| `PI_CODING_AGENT_DIR` | 自定義 omp agent 目錄 | `~/.omp/agent` |
| `OMP_WEB_STT_ENDPOINT` | OpenAI 相容的語音轉文字介面 URL | _無（預設禁用）_ |
| `OMP_WEB_STT_KEY` | STT 介面對應的 API Key | _無_ |
| `OMP_WEB_STT_MODEL` | STT 介面的模型名稱 | _無_ |

## 本地開發

```bash
git clone https://github.com/kahme247/ompweb.git
cd ompweb
npm install
npm run dev
```

本地開發伺服器執行在 [http://127.0.0.1:30178](http://127.0.0.1:30178)。

### 程式碼檢查

```bash
npm run typecheck   # TypeScript 型別檢查
npm run lint        # ESLint 檢查
npm test            # 執行測試套件
```

> **注意**：本地開發期間請勿執行 `npm run build`，以免汙染 `.next/` 導致開發伺服器異常。

## 致謝與許可證

- 分叉自 [agegr/pi-web](https://github.com/agegr/pi-web)（MIT），針對 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 進行適配。
- 採用 [MIT 許可證](./LICENSE) 開源。
