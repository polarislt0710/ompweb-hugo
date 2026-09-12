# ompweb 裡的 Worktree

ompweb 會把同一個 Git 專案的 main checkout 和 linked worktree 放在同一個專案下。你可以用它在不同分支之間切換工作目錄，同時保留統一的會話列表。

## 什麼時候會看到 Worktree 控制項

當左上角選擇的是 Git 倉庫根目錄時，專案選擇器下面會出現 worktree 切換控制項。

以下情況不會顯示：

- 當前目錄不是 Git 倉庫。
- 當前目錄在某個 Git 倉庫裡面，但不是倉庫根目錄。
- Git 無法讀取這個倉庫的 worktree 列表。

如果你在倉庫子目錄裡，先從專案選擇器開啟倉庫根目錄，再管理 worktree。

## 切換 Worktree 會影響什麼

worktree 切換器決定 ompweb 接下來使用哪個 checkout。

它會影響：

- 從側邊欄新建的會話。
- 左側 Explorer 瀏覽的檔案。
- 從 Explorer 插入到輸入框裡的檔案路徑。

已有會話仍然按同一個 project root 分組。點選一個已有會話時，側邊欄會回到這個會話原本所在的 checkout。

## 新建 Worktree

在 worktree 選單裡選擇 `New worktree...`，輸入 branch name。

ompweb 會把 checkout 放在：

```text
<repo>-worktrees/<branch>
```

例如 main checkout 是：

```text
/Users/alex/Documents/Workspace/my-project
```

新建 `codex/worktree-help` 時，目錄會是：

```text
/Users/alex/Documents/Workspace/my-project-worktrees/codex-worktree-help
```

如果這個 branch 已存在，ompweb 會為它新增 worktree。如果 branch 不存在，ompweb 會從當前 `HEAD` 建立這個 branch。

## 刪除 Worktree

非 main worktree 右側有刪除按鈕。它刪除的是這個 checkout 目錄。

刪除 worktree 不會刪除：

- Git branch。
- ompweb 的歷史會話。
- main checkout。

如果 worktree 裡有未提交或未跟蹤檔案，Git 會拒絕刪除。ompweb 會再顯示 force remove。force remove 會丟棄這個 checkout 裡的未提交檔案，只在確定不需要這些改動時使用。

## 會話和 Worktree 的關係

ompweb 按 project root 分組會話，所以 main checkout 和 linked worktree 裡的會話會顯示在一起。

但每個會話仍然記得自己建立時的 working directory：

- 在某個 worktree 建立的會話，會繼續使用那個 worktree path。
- 在 main checkout 建立的會話，會繼續使用 main checkout。
- 如果某個 worktree 已被刪除，它的歷史會話仍會顯示在專案下，方便你找回上下文。

## 常見問題

**為什麼我看不到 worktree 切換器？**
請確認當前選擇的是 Git 倉庫根目錄。非 Git 目錄和倉庫子目錄會顯示一行輕提示，而不是切換器。

**為什麼某個 branch 不能建立 worktree？**
Git 不允許同一個 branch 同時被多個 worktree checkout。你可以切到已有的 worktree，或者先刪除那個 checkout。

**Git 裡還有已經消失的 worktree 記錄怎麼辦？**
Git 有時會保留 prunable worktree 記錄。ompweb 會過濾這些記錄，不在切換器裡顯示。

**Explorer 和當前聊天看起來不在同一個分支？**
Explorer 跟隨當前選擇的 worktree；聊天跟隨開啟的會話。重新點選會話，可以把側邊欄切回這個會話所在的 checkout。
