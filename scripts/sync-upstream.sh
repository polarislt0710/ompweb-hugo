#!/usr/bin/env bash
# Merge kahme247/ompweb into the local `hugo` customization branch.
# Do NOT use in-app / npm global self-update — that replaces this fork.
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "hugo" ]]; then
  echo "Switch to the hugo branch first (now on $branch)." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash before syncing." >&2
  exit 1
fi

git fetch origin --tags
target="${1:-origin/main}"
echo "Merging $target into hugo…"
if git merge --no-edit "$target"; then
  echo "Merge clean. Next: npm install && npm test && npm run typecheck"
else
  echo "Conflicts. Keep Hugo customizations (Theme Studio, globe, Ask, zh-TW, Flow/Grill/Ask, output styles)." >&2
  echo "Then: git add -A && git commit" >&2
  exit 1
fi
