#!/bin/bash
# What the dispatch loop is doing, in one screen.
#
# The OMP window shows a session list, not a ticket list: a foreman that has
# handed its ticket to a worker sits silent in its own log while the worker runs
# for twenty minutes, so "no spinner" reads as "nothing running" when the truth
# is the opposite. This reads the worker files directly.
#
#   ompweb auto status          once
#   ompweb auto status -w       every 10s until you stop it

AUTO_PID="$HOME/.omp/agent/ompweb-auto-loop.pid"
AUTO_LOG="$HOME/Library/Logs/ompweb/auto-dispatch.log"
STATE="$HOME/.omp/agent/ompweb-dispatch-auto.json"
FRESH_S=120   # a worker file untouched this long is no longer working

age_s() { echo $(( $(date +%s) - $(stat -f %m "$1") )); }

show() {
  local cwd total done_n
  cwd=$(sed -n 's/.*"cwd": *"\([^"]*\)".*/\1/p' "$STATE" 2>/dev/null | head -1)

  if [ -f "$AUTO_PID" ] && kill -0 "$(cat "$AUTO_PID")" 2>/dev/null; then
    echo "派工 loop   運作中 (pid $(cat "$AUTO_PID"))"
  else
    echo "派工 loop   停咗"
  fi

  if [ -n "$cwd" ] && [ -d "$cwd/.omp/handoff" ]; then
    total=$(grep -cE '^### T[0-9]+:' "$cwd/.omp/handoff/plan.md" 2>/dev/null)
    done_n=$(grep -oE '^\| *T[0-9]+ *\| *done' "$cwd/.omp/handoff/status.md" 2>/dev/null \
             | grep -oE 'T[0-9]+' | sort -u | wc -l | tr -d ' ')
    echo "完成        ${done_n:-0} / ${total:-?}"
  fi

  # Live workers: every ticket file any foreman has touched recently.
  local found=0
  for f in "$HOME/.omp/agent/sessions/"*"$(basename "$cwd")"*/*/T*.jsonl; do
    [ -f "$f" ] || continue
    [ -f "$f.tombstone" ] && continue
    local a; a=$(age_s "$f")
    [ "$a" -gt "$FRESH_S" ] && continue
    [ "$found" -eq 0 ] && echo "做緊" && found=1
    printf '            %-6s 寫嘢 %ss 前\n' "$(basename "$f" .jsonl)" "$a"
  done
  [ "$found" -eq 0 ] && echo "做緊        冇工人喺度做緊"

  echo "最近"
  [ -f "$AUTO_LOG" ] && tail -4 "$AUTO_LOG" | sed 's/^/            /'
}

# --workers-only prints one line per live worker and nothing else, so callers can
# test whether it is safe to stop the loop.
if [ "${1:-}" = "--workers-only" ]; then
  cwd=$(sed -n 's/.*"cwd": *"\([^"]*\)".*/\1/p' "$STATE" 2>/dev/null | head -1)
  for f in "$HOME/.omp/agent/sessions/"*"$(basename "$cwd")"*/*/T*.jsonl; do
    [ -f "$f" ] || continue
    [ -f "$f.tombstone" ] && continue
    [ "$(age_s "$f")" -gt "$FRESH_S" ] && continue
    printf '  %s  寫嘢 %ss 前\n' "$(basename "$f" .jsonl)" "$(age_s "$f")"
  done
  exit 0
fi

if [ "${1:-}" = "-w" ] || [ "${1:-}" = "--watch" ]; then
  while true; do clear; date '+%H:%M:%S'; echo; show; sleep 10; done
else
  show
fi
