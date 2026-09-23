# ompweb — repository guide

## Boundary
This repository is the browser UI. The local `omp` process is the agent engine, reached through `omp --mode rpc-ui`.
Keep the existing process/RPC boundary. Do not import Bun-only `@oh-my-pi/*` or `@earendil-works/*` packages into Node/Next.js, or bypass OMP with a second model client.

## Start and verify
- Use the actual checkout and current dirty working tree; preserve unrelated changes.
- Development: `npm run dev`. Typecheck: `node_modules/.bin/tsc --noEmit`.
- Read this checkout's `package.json` for current lint/test scripts and run the checks required for the changed behavior.
- Do not run `next build` during development: it can contaminate `.next/` and break the dev server. Keep this rule scoped to ompweb, not other repositories.
- For setup, launching, networking or binary-resolution changes, read the relevant sections of `HUGO.md` and `DESIGN.md` before editing.

## Before changing a subsystem
All paths here are repository-relative. Search `docs/agents/REFERENCE.md` for the topics below and read the complete matching sections, including their constraints, before editing that subsystem.
The reference preserves the previous instructions. It is not a startup reading list. Read `File Map` only when locating unfamiliar code.

| Change area | Reference topics to read |
| --- | --- |
| RPC, streaming, completion or reconnection | RPC session lifecycle; Live tool execution; Event protocol differences; Running state SSE |
| Tasks and subagent display/history | Composer-attached panels; Subagent integration |
| Session parsing, branching or exports | Two kinds of branching; ToolCall field normalization; omp Session File Format |
| Files, projects, worktrees or sidebar | Worktrees and project grouping; Managed projects sidebar; any adjacent cache/ordering rules |
| MCP, plugins, skills, models or authentication | MCP; Plugins and skills; Auth and model config; Update notifications |
| Layout, colors or controls | Design Tokens & UI Kit; the section for the component being changed |

If the reference is absent, unreadable or missing a required topic, report a migration gap instead of inventing its rules.
When a document and implementation disagree, identify the discrepancy; do not silently pick whichever is convenient.

## Invariants
- Preserve path authorization and allowed-root checks. Do not expose credentials through APIs, UI, logs or artifacts.
- Keep RPC commands and event handling compatible with the installed engine. Unknown frames must not crash the UI or resurrect an ended run.
- Preserve atomic configuration writes and unrelated configuration fields.
- Keep forked sessions distinct from in-session branches, and preserve worktree protections for dirty files.
- Use the shared UI primitives and semantic design tokens. Keep display-only changes separate from prompt/model behavior.
- Change only the requested behavior. Preserve existing agent/model mappings, skills and MCP configuration unless explicitly tasked to change them.

## Delivery
- Inspect the final diff and report the checks actually run, their outcomes and any unverified behavior.
- A completed run is not proof of acceptance. Do not claim a change is deployed or token-saving without checking that claim.
- When behavior changes, update its existing reference section instead of appending a second version to this guide.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
