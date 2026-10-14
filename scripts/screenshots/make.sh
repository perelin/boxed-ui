#!/bin/bash
# Records a short real Claude Code session per theme and renders it to docs/screenshots/<theme>.png.
# Needs tmux, python3, Google Chrome and a logged-in `claude`. Each theme costs one short model turn.
# usage: scripts/screenshots/make.sh [theme ...]   (default: every theme in themes/)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
OUT="$ROOT/docs/screenshots"
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
DEMO=$(mktemp -d)
WORK=$(mktemp -d)
S=boxed-ui-shot
trap 'tmux kill-session -t $S 2>/dev/null || true; rm -rf "$DEMO" "$WORK"' EXIT
mkdir -p "$OUT"

if [ $# -eq 0 ]; then set -- $(cd "$ROOT/themes" && ls *.json | sed 's/\.json$//'); fi

wait_for() { for _ in $(seq 1 60); do sleep 2; tmux capture-pane -p -t $S | grep -q -- "$1" && return 0; done; echo "timed out waiting for: $1" >&2; return 1; }

for theme in "$@"; do
  # Without the TMUX variables Claude Code emits 24-bit colour; --setting-sources local keeps the
  # recorder's own plugins, hooks and status line out of the picture.
  tmux new-session -d -s $S -x 110 -y 60 -c "$DEMO" \
    "env -u TMUX -u TMUX_PANE TERM=xterm-256color COLORTERM=truecolor claude --setting-sources local --plugin-dir '$ROOT' --append-system-prompt \"\$(cat '$HERE/demo-system-prompt.txt')\""
  wait_for '❯'; sleep 2
  # a fresh temp folder asks for trust first
  if tmux capture-pane -p -t $S | grep -q 'trust this folder'; then
    tmux send-keys -t $S Down; sleep 0.3; tmux send-keys -t $S C-m; sleep 4
  fi
  tmux send-keys -t $S -l "/boxed-ui $theme"; sleep 1; tmux send-keys -t $S Escape; sleep 0.3; tmux send-keys -t $S C-m; sleep 2
  tmux send-keys -t $S -l "I'm building a small CLI that stores bookmarks. Which database should I use?"; sleep 1; tmux send-keys -t $S C-m
  wait_for 'Postgres'; sleep 2
  tmux send-keys -t $S C-m; sleep 2
  tmux capture-pane -p -t $S | grep -qi 'submit' && tmux send-keys -t $S C-m
  wait_for 'for [0-9]*s · done'; sleep 2
  tmux capture-pane -p -e -J -S - -t $S > "$WORK/$theme.ansi"
  tmux kill-session -t $S

  python3 "$HERE/ansi2html.py" "$WORK/$theme.ansi" > "$WORK/$theme.html"
  dims=$("$CHROME" --headless=new --dump-dom --virtual-time-budget=2000 "file://$WORK/$theme.html" 2>/dev/null | grep -o '<title>[0-9x]*' | cut -c8-)
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size="${dims%x*},${dims#*x}" \
    --screenshot="$OUT/$theme.png" "file://$WORK/$theme.html" >/dev/null 2>&1
  echo "$theme → docs/screenshots/$theme.png"
done
