---
name: gcloud
description: >
  Operate Google Cloud (GCP) with the local gcloud CLI already logged in.
  Use for projects, IAM, Cloud Run, Cloud Storage buckets, Compute, logs,
  and APIs. Do not use this for Gmail or Google Drive files — that is the
  google-workspace skill / gog CLI.
---

# Google Cloud (`gcloud`)

This Mac already has `gcloud` at `/opt/homebrew/bin/gcloud`.

## Accounts / project

```bash
gcloud auth list
gcloud config configurations list
gcloud config get-value project
```

Current default (as of setup): account `admin@edsight.ai`, project `hugo-jarvis-hk-0710`. Also logged in: `polarislt0710@gmail.com`.

Switch account for one command:

```bash
gcloud … --account=admin@edsight.ai --project=hugo-jarvis-hk-0710
```

Application Default Credentials exist at `~/.config/gcloud/application_default_credentials.json`. Prefer `gcloud` over raw REST.

## Style

- `--format=json` for anything you will parse.
- `--quiet` so it does not prompt.
- Preview deletes (`--dry-run` where supported) and state the project/account before mutating.

## Not this skill

Gmail, Drive, Docs, Sheets, Calendar → `google-workspace` / `gog`.
