# ompweb-hugo

Hugo's daily-driver fork of [kahme247/ompweb](https://github.com/kahme247/ompweb).

This repo is the **browser UI**. The agent engine is still local [`omp`](https://github.com/can1357/oh-my-pi). The UI talks to `omp --mode rpc-ui`. It does not embed `@oh-my-pi/*` and does not call Anthropic / OpenAI / xAI APIs itself.

## You need `omp` first

1. Install omp: `curl -fsSL https://omp.sh/install | sh`
2. Confirm: `omp --version`
3. Inside `omp`, log in to the providers you already pay for (`/login`). Quota lives in omp, not in this web app.

Without omp, the page can still open, but you cannot chat.

## Run this fork

```bash
git clone https://github.com/polarislt0710/ompweb-hugo.git
cd ompweb-hugo
npm install
cp .env.example .env.local   # optional: set OMP_WEB_PASSWORD
npm run dev                  # http://127.0.0.1:30178
```

Do **not** run `npm run build` while you are iterating on the UI. Use `npm run typecheck`, `npm run lint`, `npm test`.

LAN / password:

```bash
# .env.local must set OMP_WEB_PASSWORD before binding 0.0.0.0
npm run dev:lan
```

## What this fork keeps (vs stock kahme247)

- Real omp `ask` cards (not markdown fake buttons)
- Theme Studio presets ported from 37chengshan
- Composer skill catalog (Dev / Design / Daily) + `/agy`
- Localhost iframe browser pane, with experimental Live Chrome for non-iframe sites
- Public-host / Cloudflare tunnel origin fixes (`omp.bizobot.com`)
- Owner i18n and daily-driver chrome

Stock `npx @kahme247/ompweb` does **not** include these. After clone, use this checkout.

## macOS: `ompweb` command + start at login

From this checkout:

```bash
chmod +x scripts/ompweb-cli.sh
ln -sf "$(pwd)/scripts/ompweb-cli.sh" ~/.local/bin/ompweb
ompweb install-service
```

`install-service` writes a LaunchAgent plus a trampoline in `~/.local/share/ompweb/serve.sh`. macOS will not let launchd execute scripts that live under `~/Documents`; the trampoline has to sit outside that folder. The web password is copied into the plist (mode 600) at install time — re-run `ompweb install-service` after you change `.env.local`.

Put `~/.local/bin` before `/opt/homebrew/bin` on `PATH`, otherwise Homebrew's stock `ompweb` wins.

```
ompweb           # restart + open http://127.0.0.1:30178
ompweb status
ompweb stop
```

On this machine the Cloudflare tunnel `com.hugo.ompweb-tunnel` already maps `https://omp.bizobot.com` → `127.0.0.1:30178`. Other people should use Tailscale or their own reverse proxy; do not bind `0.0.0.0` without a password.

## Bundled omp skills

The checkout ships project skills under `.omp/skills/` (`antigravity-cli`, `gcloud`, `google-workspace`, `gpt-image-2.5`). omp discovers that folder when this repo is the session cwd. Copy or edit them to match your machine; they are not a second skill format.

## Reviewer in ChatGPT, workers in omp

GPT-6 Pro (or any ChatGPT model) reviews the code and writes the ticket plan;
omp's foreman assigns the tickets to cheap workers and records the results. The
two sides meet in `.omp/handoff/`:

| File | Written by | Holds |
|---|---|---|
| `plan.md` | reviewer | tickets: agent, dependencies, files, verify command |
| `status.md` | foreman | per-ticket state, files changed, verify output, questions |
| `decisions.md` | either | decisions and why |

The Handoff tab shows one card with one action, driven by state
(`components/DispatchSection.tsx`):

1. **派工** (or **批准並派工** when ChatGPT asked) starts a foreman session and
   opens it in the chat, so the run is watchable. The foreman opens with a
   three-line read of the plan, then dispatches; it never re-reviews the code,
   retries a failure once with `worker`, then marks it blocked, and keeps
   `status.md` current.
2. While it runs the card shows **睇住執行** (jump back to that session).
3. When it is done, **交返 GPT 覆核** copies a review prompt and opens ChatGPT;
   the reviewer reads `status.md` and the diff through the connector and either
   approves or saves the next round of tickets, which flips the card back to 1.

`lib/work-plan.ts` holds the ticket format and its validation; a ticket's
`verify` must be able to pass on its own, so a shared test suite belongs on the
last ticket. Workers are told never to wait on `hub` — a blocking worker that
asks its parent a question deadlocks the run.

### ChatGPT connector (MCP)

`https://<public host>/mcp` is a Streamable-HTTP MCP server. In ChatGPT:
Settings → Apps → Developer mode → new app → paste the URL → auth **OAuth**.

- Sign-in is the ompweb password plus an explicit Allow on `/oauth/authorize`;
  OAuth 2.1 with PKCE, dynamic client registration and CIMD (`lib/mcp/oauth.ts`).
- Redirect URIs are limited to ChatGPT hosts, so a code cannot be delivered
  anywhere else. Changing `OMP_WEB_PASSWORD` revokes every connector token, and
  the Handoff tab has a disconnect button.
- Tools: list projects, read/search files, git diff, read handoff, write
  `plan.md`, request a dispatch, message a foreman, search the web. No shell,
  no source edits.
- A ticket that needs a web lookup goes to `agent: researcher`
  (`~/.omp/agent/agents/researcher.md`), which has omp's `web_search` and the
  same Perplexity provider, and writes its findings to a file the other tickets
  depend on — rather than a coding worker guessing.
- Visual review (`lib/mcp/screenshots.ts`, `lib/mcp/capture.ts`): `view_image`
  returns a mockup or saved screenshot from the repo; `capture_page` drives one
  headless Chrome over DevTools to shoot up to 6 pages per call — project HTML
  files, a local dev server, or a deployed site — full-page, at desktop and/or
  phone widths. It never starts a server or runs a project command.
- Capture targets are address-checked before the browser opens: loopback is
  allowed (the owner's dev server), every other host is resolved and refused if
  it lands on a private, link-local or otherwise internal address, so the
  connector cannot be turned into a way to reach the LAN. Set
  `OMP_WEB_MCP_CAPTURE_HOSTS=orcagrade.com,example.com` to narrow it to named
  sites; unset means any public host.
- Signed-in screenshots (`lib/mcp/capture-profiles.ts`): pages behind a login
  come back logged out unless a session was saved for that host. Handoff tab →
  ChatGPT connector → *Signed-in screenshots*: type the login page, press
  **Open browser**, log in by hand in the Chrome window that appears on this
  Mac, press **I'm logged in**. The window is a real browser — no password is
  typed into OMP Web or stored by it. Pressing the button reads the session out
  of the live window over DevTools before closing it: its cookies, and the
  localStorage/sessionStorage of every page open on that host. Neither survives
  on its own — Chrome only writes cookies that carry an expiry, and orcagrade
  keeps its token in localStorage and sets no cookie at all. Cookies are set
  directly in the capture browser; storage is installed by a script that runs
  before the page's own scripts, which is when an app reads its token. If the window was
  already closed there is nothing to read, and the login is refused rather than
  marked done — otherwise the reviewer gets logged-out screenshots labelled
  "signed in". The session lives in
  `~/.omp/agent/ompweb-capture-profiles/<host>` (0700) and is used *only* for
  that host and its subdomains; every capture runs on a throwaway copy, so a
  captured page cannot change or end the saved session, and two captures never
  fight over Chrome's profile lock. Shots taken this way are labelled
  "signed in". It is a real session: a URL that acts on a GET would act as the
  owner, so only give a profile to hosts that are safe to browse as yourself.
  Forget one with the × next to it, which deletes its cookies.
- `ompweb capture <target...>` (`scripts/capture-cli.mjs`) is the same capture
  from a shell, because an omp worker has only bash: a plan that says "capture
  these three pages" had no way to be carried out otherwise. It writes PNGs plus
  a `captures.json` manifest, uses the saved signed-in session for that host, and
  exits 2 when anything redirected or returned 4xx. Every shot — here and over
  the connector — records the URL the browser actually landed on and the main
  document's HTTP status, so a 404 page or a silent bounce to the login screen
  cannot pass as the screen that was asked for.
- Web search (`lib/mcp/web-search.ts`): `search_web` shells out to
  `omp search`, so it runs on the owner's existing provider — Perplexity over
  OAuth at the top of `providers.webSearchOrder` — and costs no model tokens.
  Answers come back with their sources named. `focus` defaults to `hkdse`,
  which prepends a preamble pinning the answer to Hong Kong exam sources
  (hkeaa.edu.hk, edb.gov.hk, cd.edu.hk) instead of whatever syllabus ranks
  highest worldwide; `focus: "web"` asks the question as written. Override the
  provider with `OMP_WEB_SEARCH_PROVIDER` and the preamble with
  `OMP_WEB_SEARCH_HKDSE_PREAMBLE`.
- Only git repositories share source, and only files `git ls-files` would show
  (ignored files stay hidden), minus a secret-name denylist. Non-git projects
  share the handoff notes only.
- Dispatches and foreman messages wait for approval in the Handoff tab. Set
  `OMP_WEB_MCP_DIRECT_DISPATCH=1` to let ChatGPT start runs itself.
- Other env: `OMP_WEB_MCP=off` disables the connector,
  `OMP_WEB_MCP_BASE_URL` overrides the public URL (defaults to
  `https://$OMP_WEB_PUBLIC_HOST`), `OMP_WEB_MCP_REDIRECT_HOSTS` adds redirect
  hosts for local testing.

The connector needs `OMP_WEB_PASSWORD`; without it every `/mcp` and `/oauth`
route returns 404.

## Secrets

Never commit `.env.local`. `OMP_WEB_PASSWORD` is the web unlock screen, not an AI login.
