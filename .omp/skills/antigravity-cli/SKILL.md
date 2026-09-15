---
name: antigravity-cli
description: >
  Delegate work to the local official Antigravity CLI (`agy`) via bash.
  Use when the user asks for Antigravity CLI, clicks the Antigravity CLI
  button, or runs /agy. Do not use the google-antigravity omp provider.
---

# Antigravity CLI (`agy`)

Run the **official** Antigravity CLI on this machine. Cloud Code Assist sees `agy`, not omp. Invoke it with the **bash** tool. Label the tool `bash`, never an official omp worker.

Do not implement the task yourself. Do not call `google-antigravity` models.

## Command

```bash
agy_bin=$(command -v agy 2>/dev/null || true)
if [ -z "$agy_bin" ] && [ -x "$HOME/.local/bin/agy" ]; then
  agy_bin="$HOME/.local/bin/agy"
fi
if [ ! -x "$agy_bin" ]; then
  echo "agy not found on PATH or at ~/.local/bin/agy" >&2
  exit 127
fi

"$agy_bin" -p "$TASK" \
  --model gemini-3.8-flash-high \
  --dangerously-skip-permissions \
  --print-timeout 15m
```

Set `TASK` to the user's request (heredoc if it has quotes or newlines). Run from the session project cwd.

`--dangerously-skip-permissions` is required in print mode so `agy` does not wait on a TTY approval the web session cannot answer.

## After it exits

Summarize stdout/stderr for the user. If exit 127, say Antigravity CLI is not installed (`agy` / `~/.local/bin/agy`). If Cloud Code Assist 429, report the CLI output; do not retry through omp's google-antigravity provider.
