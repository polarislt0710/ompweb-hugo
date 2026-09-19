#!/bin/bash
# Start / restart Hugo's ompweb fork (this checkout), not the stock
# Homebrew `@kahme247/ompweb` binary.
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
ROOT="$(cd "$(dirname "$SOURCE")/.." && pwd)"
LABEL="${OMPWEB_LAUNCHD_LABEL:-com.hugo.ompweb}"
PORT="${OMPWEB_PORT:-30178}"
HOST="${OMPWEB_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}"
PUBLIC_URL="${OMPWEB_PUBLIC_URL:-https://omp.bizobot.com}"
LOG_DIR="${HOME}/Library/Logs/ompweb"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
PATH_FOR_SERVICE="/opt/homebrew/bin:${HOME}/.bun/bin:${HOME}/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cmd="${1:-restart}"

NPM_BIN="${OMPWEB_NPM_BIN:-/opt/homebrew/bin/npm}"
SHARE_DIR="${HOME}/.local/share/ompweb"
SERVE_SH="${SHARE_DIR}/serve.sh"

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

xml_escape() {
  local s=$1
  s=${s//&/&amp;}
  s=${s//</&lt;}
  s=${s//>/&gt;}
  printf '%s' "$s"
}

load_env() {
  if [[ -f "$ROOT/.env.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env.local"
    set +a
  fi
}

port_pids() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

service_loaded() {
  launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1
}

wait_up() {
  local n=0
  while (( n < 40 )); do
    if curl -fsS -o /dev/null --max-time 2 "$URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
    n=$((n + 1))
  done
  return 1
}

kill_port() {
  local pids
  pids="$(port_pids)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
    pids="$(port_pids)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

write_serve_sh() {
  # launchd cannot exec scripts inside ~/Documents (TCC). Keep the trampoline
  # outside Documents; npm/node then read the checkout as data.
  mkdir -p "$SHARE_DIR" "$LOG_DIR"
  cat >"$SERVE_SH" <<EOF
#!/bin/bash
set -euo pipefail
cd $(printf '%q' "$ROOT")
export PATH=$(printf '%q' "$PATH_FOR_SERVICE")
exec $(printf '%q' "$NPM_BIN") run dev
EOF
  chmod 700 "$SERVE_SH"
}

write_plist() {
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  local env_xml password_note=""
  env_xml="    <key>PATH</key><string>$(xml_escape "$PATH_FOR_SERVICE")</string>
    <key>HOME</key><string>$(xml_escape "$HOME")</string>"
  if [[ -n "${OMP_WEB_PASSWORD:-}" ]]; then
    env_xml+=$'\n'"    <key>OMP_WEB_PASSWORD</key><string>$(xml_escape "$OMP_WEB_PASSWORD")</string>"
    password_note="yes"
  fi
  if [[ -n "${OMP_WEB_PUBLIC_HOST:-}" ]]; then
    env_xml+=$'\n'"    <key>OMP_WEB_PUBLIC_HOST</key><string>$(xml_escape "$OMP_WEB_PUBLIC_HOST")</string>"
  fi
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$SERVE_SH")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
${env_xml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG_DIR/ompweb.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG_DIR/ompweb.err.log")</string>
</dict>
</plist>
EOF
  chmod 600 "$PLIST"
  if [[ -n "$password_note" ]]; then
    log "note:      web password stored in $PLIST (mode 600)"
  fi
}

cmd_serve() {
  [[ -d "$ROOT" ]] || die "ompweb checkout missing: $ROOT"
  [[ -f "$ROOT/package.json" ]] || die "not an ompweb checkout: $ROOT"
  load_env
  export PATH="${PATH_FOR_SERVICE}:${PATH:-/usr/bin:/bin}"
  cd "$ROOT"
  exec /opt/homebrew/bin/npm run dev
}

cmd_install_service() {
  [[ "$(uname -s)" == "Darwin" ]] || die "launchd is macOS-only"
  [[ -x "$NPM_BIN" ]] || die "npm not found at $NPM_BIN"
  load_env
  write_serve_sh
  write_plist
  launchctl bootout "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  kill_port
  launchctl bootstrap "$DOMAIN" "$PLIST"
  log "installed: $PLIST"
  log "url:       $URL"
  log "public:    $PUBLIC_URL"
  log "logs:      $LOG_DIR/ompweb.log"
}

cmd_uninstall_service() {
  launchctl bootout "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  log "uninstalled: $LABEL"
}

cmd_start() {
  if service_loaded; then
    if [[ -n "$(port_pids)" ]]; then
      log "already running on $URL"
    else
      launchctl kickstart "${DOMAIN}/${LABEL}"
    fi
  else
    cmd_install_service
  fi
  wait_up || die "started but $URL did not answer. See $LOG_DIR/ompweb.err.log"
}

cmd_stop() {
  if service_loaded; then
    launchctl bootout "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  fi
  kill_port
  log "stopped $URL"
}

cmd_restart() {
  if service_loaded; then
    kill_port
    launchctl kickstart -k "${DOMAIN}/${LABEL}"
  else
    cmd_install_service
  fi
  wait_up || die "restarted but $URL did not answer. See $LOG_DIR/ompweb.err.log"
}

cmd_status() {
  if service_loaded; then
    log "launchd: loaded ($LABEL)"
  else
    log "launchd: not loaded ($LABEL)"
  fi
  local pids
  pids="$(port_pids)"
  if [[ -n "$pids" ]]; then
    log "listen:  $HOST:$PORT pid $pids"
  else
    log "listen:  down"
  fi
  if curl -fsS -o /dev/null --max-time 3 "$URL" >/dev/null 2>&1; then
    log "local:   $URL up"
  else
    log "local:   $URL down"
  fi
  if curl -fsS -o /dev/null --max-time 8 "$PUBLIC_URL" >/dev/null 2>&1; then
    log "public:  $PUBLIC_URL up"
  else
    log "public:  $PUBLIC_URL down"
  fi
}

cmd_open() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    open "$URL"
  fi
  log "$URL"
  log "$PUBLIC_URL"
}

usage() {
  cat <<EOF
Usage: ompweb [restart|start|stop|status|open|capture|auto|serve|install-service|uninstall-service]

  restart            Stop and start this fork on $URL (default)
  start              Start if needed, keep the existing process
  stop               Unload launchd and free port $PORT
  status             Local + public health
  open               Open $URL in the browser
  capture            Screenshot pages (signed in, when a session was saved)
  auto               Overnight dispatch loop: start | stop | status
  serve              Foreground next-dev (used by launchd)
  install-service    Install login LaunchAgent
  uninstall-service  Remove login LaunchAgent

This wrapper is the Hugo fork at:
  $ROOT
Homebrew \`ompweb\` is stock @kahme247/ompweb and is shadowed on PATH.
EOF
}

# Screenshots from a shell, so the agents executing a plan can do the
# "capture these pages" tickets. Arguments pass straight through.
cmd_capture() {
  node "$ROOT/bin/omp-web.js" capture "$@"
}

# The overnight dispatch loop, detached from the dev server that hot-reloads.
AUTO_LOG="$HOME/Library/Logs/ompweb/auto-dispatch.log"
AUTO_PID="$HOME/.omp/agent/ompweb-auto-loop.pid"
cmd_auto() {
  case "${1:-status}" in
    start)
      if [ -f "$AUTO_PID" ] && kill -0 "$(cat "$AUTO_PID")" 2>/dev/null; then
        echo "already running (pid $(cat "$AUTO_PID"))"; return 0
      fi
      mkdir -p "$(dirname "$AUTO_LOG")"
      nohup node "$ROOT/bin/omp-web.js" auto-loop >>"$AUTO_LOG" 2>&1 &
      echo $! > "$AUTO_PID"
      sleep 2
      echo "started (pid $(cat "$AUTO_PID")) · log $AUTO_LOG"
      tail -3 "$AUTO_LOG"
      ;;
    stop)
      # Stopping the loop takes its foremen with it: killing the loop at 15:39
      # while T164 was twelve minutes in threw that work away. Say so first.
      if [ "${2:-}" != "-f" ] && [ -n "$("$ROOT/scripts/auto-status.sh" --workers-only 2>/dev/null)" ]; then
        echo "工人仲做緊嘢，熄咗會連佢哋一齊殺埋："
        "$ROOT/scripts/auto-status.sh" --workers-only
        echo "真係要熄就用: ompweb auto stop -f"
        return 1
      fi
      if [ -f "$AUTO_PID" ] && kill -0 "$(cat "$AUTO_PID")" 2>/dev/null; then
        kill "$(cat "$AUTO_PID")" && echo "stopped (pid $(cat "$AUTO_PID"))"
      else
        echo "not running"
      fi
      rm -f "$AUTO_PID"
      ;;
    status)
      shift || true
      "$ROOT/scripts/auto-status.sh" "$@"
      ;;
    *) echo "usage: ompweb auto [start|stop|status [-w]]"; return 2 ;;
  esac
}

case "$cmd" in
  capture) shift; cmd_capture "$@" ;;
  auto) shift; cmd_auto "$@" ;;
  serve) cmd_serve ;;
  install-service) cmd_install_service ;;
  uninstall-service) cmd_uninstall_service ;;
  start) cmd_start; cmd_open ;;
  stop) cmd_stop ;;
  restart) cmd_restart; cmd_open ;;
  status) cmd_status ;;
  open) cmd_open ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
