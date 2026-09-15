---
name: google-workspace
description: >
  Operate Gmail, Drive, Docs, Sheets, Slides, Calendar, Tasks, Contacts, and
  Forms for the owner's Google accounts. Prefer the local `gog` CLI with
  --account. Use Google Workspace MCP tools when they are connected. Use when
  the user mentions Gmail, Google Drive, Docs, Sheets, Calendar, Workspace,
  or multiple Google accounts.
---

# Google Workspace (Gmail / Drive / Docs / Sheets)

Do **not** invent a second Google client. Use what is already on this machine.

## Order of tools

1. **`gog` CLI** (preferred for day-to-day ops). Multi-account via `-a EMAIL`.
2. **Google Workspace MCP** (`google-workspace` in `~/.omp/agent/mcp.json`) when those tools are listed in the session.
3. **`gcloud`** only for Google Cloud / GCP (projects, IAM, Cloud Run, Storage buckets as GCP). Drive files are `gog`, not `gsutil`, unless the user names a GCS bucket.

Always pass `-j` (JSON) or `--plain` when scripting. Always pass `--no-input` in omp so it never waits on a TTY prompt. Use `-n` / `--dry-run` before destructive writes.

## Accounts

Known logins on this Mac:

| Email | Typical use | How to select |
|---|---|---|
| `polarislt0710@gmail.com` | Personal Gmail / Drive / Workspace | `gog -a polarislt0710@gmail.com …` |
| `admin@edsight.ai` | Edsight Workspace + `gcloud` (active) | `gog -a admin@edsight.ai …` after that account is logged in |

If `gog` returns `invalid_grant` / `Bad Request`, the refresh token is dead. Tell the user to run this in **their** terminal (browser consent), then retry:

```bash
gog login polarislt0710@gmail.com
gog login admin@edsight.ai
```

Do not try to complete Google OAuth from a headless omp bash if it blocks on a browser.

List stored gog accounts: `gog auth list --plain`

## `gog` map

```bash
gog -a EMAIL gmail search 'newer_than:7d' --plain
gog -a EMAIL gmail send --to ADDR --subject '…' --body '…' --dry-run
gog -a EMAIL drive ls --plain
gog -a EMAIL drive search 'query' --plain
gog -a EMAIL calendar … 
gog -a EMAIL docs …
gog -a EMAIL sheets …
gog -a EMAIL slides …
gog -a EMAIL tasks …
gog -a EMAIL contacts …
gog -a EMAIL forms …
```

`gog --help` and `gog <service> --help` are the source of flags. Prefer `--account` / `-a` on every call so the wrong inbox is never used.

## MCP

Server name: `google-workspace` (uvx `workspace-mcp`). First connection may open a Google consent page. After that, use the MCP tools the session actually exposes. If MCP is disconnected, fall back to `gog`.

## Safety

- Confirm the **account email** before send/delete/share.
- Do not dump full message bodies or PII into the chat unless the user asked to read that mail.
- Workspace Chat/Spaces may need extra Google Chat app setup; skip Chat unless the user asked.
