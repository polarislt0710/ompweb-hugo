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

## Secrets

Never commit `.env.local`. `OMP_WEB_PASSWORD` is the web unlock screen, not an AI login.
