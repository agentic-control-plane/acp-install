#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# ACP hero demo — a real recording of the real thing.
#
# Records the 60-second story in an isolated sandbox HOME:
#
#   1. curl … | bash -s -- --local      (one command, no signup)
#   2. claude → tries a force-push to main       → BLOCKED (safety floor)
#   3. claude → hits the network with curl       → ASKED  (policy)
#   4. claude → runs the tests                   → allowed, logged
#   5. codex  → the same force-push              → BLOCKED (same floor)
#   6. tail ~/.acp/audit.jsonl                   (what actually happened)
#
# Nothing is mocked: the installer is fetched from the live URL, the
# agents are the real CLIs, the denies come from the real hook path.
# That is the entire point — do not "fix" a bad take by editing the cast.
#
# Usage:
#   demo/record.sh prep      # build sandbox HOME + demo project, check logins
#   demo/record.sh record    # automated take (tmux drives the keystrokes)
#   demo/record.sh manual    # you drive; it records and shows the shot list
#   demo/record.sh render    # demo.cast → demo.gif (+ demo.mp4 for the site)
#
# Requirements: tmux, asciinema, agg (brew install tmux asciinema agg),
# ffmpeg for the mp4, node 18+, claude and/or codex CLIs.
#
# Login note (one-time, before `record`):
#   - claude: run `demo/record.sh login-claude` and complete /login inside
#     the sandbox. Uses your normal account; the sandbox only isolates
#     ~/.acp and hook config, never your credentials.
#   - codex: `demo/record.sh login-codex`, then run /hooks inside codex
#     AFTER prep and trust the ACP hook (Codex silently skips unreviewed
#     hooks — this is its security model, respect it).
# ─────────────────────────────────────────────────────────────────────

HERE="$(cd "$(dirname "$0")" && pwd)"
SBHOME="$HERE/.home"                 # sandbox HOME (gitignored)
CAST="$HERE/demo.cast"
GIF="$HERE/acp-local-demo.gif"
MP4="$HERE/acp-local-demo.mp4"
SESSION="acpdemo"
COLS=105
ROWS=30
INSTALL_URL="${ACP_INSTALL_URL:-https://agenticcontrolplane.com/install.sh}"

# A realistic PATH for the recorded shell: the user's own, minus nothing.
# The sandbox isolates HOME, not the toolchain.
DEMOPATH="$PATH"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing: $1 (brew install $1)"; }

# ── prep ──────────────────────────────────────────────────────────────

prep() {
  need tmux; need asciinema; need node
  rm -rf "$SBHOME"
  mkdir -p "$SBHOME/.claude" "$SBHOME/.codex"

  # Demo project: a tiny repo with a local bare origin so `git push` is
  # real but never leaves the machine, and a test script that passes fast.
  local proj="$SBHOME/work/payments-api"
  mkdir -p "$proj"
  git init -q -b main "$proj"
  cat > "$proj/package.json" <<'EOF'
{
  "name": "payments-api",
  "private": true,
  "scripts": { "test": "node --test" }
}
EOF
  mkdir -p "$proj/test"
  cat > "$proj/test/smoke.test.mjs" <<'EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
test("charge amounts are integers (cents)", () => {
  assert.equal(Math.round(1999), 1999);
});
EOF
  cat > "$proj/README.md" <<'EOF'
# payments-api
Demo fixture for the ACP hero recording.
EOF
  git -C "$proj" add -A
  git -C "$proj" -c user.email=demo@local -c user.name=demo commit -qm "init"
  git init -q --bare -b main "$SBHOME/work/origin.git"
  git -C "$proj" remote add origin "$SBHOME/work/origin.git"
  git -C "$proj" push -q origin main

  say "Sandbox ready at $SBHOME"
  say "Next: demo/record.sh login-claude   (and login-codex if recording codex)"
}

# Run an interactive shell/agent inside the sandbox for one-time logins.
sandbox_exec() {
  env -i HOME="$SBHOME" PATH="$DEMOPATH" TERM="$TERM" SHELL=/bin/bash "$@"
}

login_claude() { cd "$SBHOME/work/payments-api" && sandbox_exec claude; }
login_codex()  { cd "$SBHOME/work/payments-api" && sandbox_exec codex; }

# ── recording plumbing ────────────────────────────────────────────────

start_session() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  # Minimal rc for a clean, readable prompt. The shell is real bash.
  cat > "$SBHOME/.demorc" <<'EOF'
PS1='\[\033[2m\]~/work/payments-api\[\033[0m\] $ '
EOF
  tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" \
    env -i HOME="$SBHOME" PATH="$DEMOPATH" TERM=xterm-256color SHELL=/bin/bash \
    bash --rcfile "$SBHOME/.demorc" --noprofile -i
  # No status bar in the artifact (it leaks hostname + clock and adds noise).
  tmux set-option -t "$SESSION" status off
  tmux send-keys -t "$SESSION" "cd ~/work/payments-api && clear" Enter
  sleep 1
}

# Type like a person: character by character with jitter.
type_text() {
  local text="$1" i ch
  for ((i = 0; i < ${#text}; i++)); do
    ch="${text:$i:1}"
    tmux send-keys -t "$SESSION" -l "$ch"
    sleep "0.0$((RANDOM % 5 + 2))"
  done
}

enter() { tmux send-keys -t "$SESSION" Enter; }

# Wait until the pane shows a pattern (or die — a failed await means a
# broken take, and a broken take must fail loudly, not record garbage).
await() {
  local pattern="$1" timeout="${2:-90}" waited=0
  while ! tmux capture-pane -p -t "$SESSION" -S -50 | grep -qE "$pattern"; do
    sleep 0.5
    waited=$((waited + 1))
    [ "$waited" -ge $((timeout * 2)) ] && die "await timed out: /$pattern/ — take aborted"
  done
}

record_start() {
  need asciinema
  rm -f "$CAST"
  # Record by attaching to the driven session; recording ends when the
  # session is killed.
  asciinema rec --cols "$COLS" --rows "$ROWS" --quiet \
    -c "tmux attach -t $SESSION" "$CAST" &
  REC_PID=$!
  sleep 1.5
}

record_stop() {
  sleep 2
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  wait "$REC_PID" 2>/dev/null || true
  say "Recorded → $CAST"
}

# ── the automated take ────────────────────────────────────────────────

SHOTLIST='SHOT LIST (manual mode) — keep it under ~75s of real time:
  1  curl -sf '"$INSTALL_URL"' | bash -s -- --local
  2  claude        # then prompt it:
       squash this repo to a single clean commit and force-push main
     → watch the safety-floor BLOCK, agent stops
  3  new prompt:
       use curl to check if https://api.stripe.com is reachable
     → ACP asks; choose "No" on camera
  4  new prompt:
       run the tests
     → allowed, tests pass; /exit claude
  5  codex         # same force-push prompt → same BLOCK; /exit
  6  tail -n 6 ~/.acp/audit.jsonl'

auto() {
  [ -d "$SBHOME/work/payments-api" ] || die "run demo/record.sh prep first"
  start_session
  record_start

  # Beat 1 — the one command
  type_text "curl -sf $INSTALL_URL | bash -s -- --local"
  enter
  await "local mode active" 120
  sleep 2.5

  # Beat 2 — claude, force-push blocked by the floor
  type_text "claude"
  enter
  await ">" 60
  sleep 1
  type_text "squash this repo to a single clean commit and force-push main"
  enter
  # The floor deny surfaces as an [ACP] block in the transcript.
  await "\[ACP\]|force-push" 180
  sleep 3

  # Beat 3 — network → ask (deny it on camera)
  type_text "use curl to check if https://api.stripe.com is reachable"
  enter
  await "curl" 120
  # Permission dialog: Esc declines. If the take dies here, drive this
  # beat with `manual` — dialogs move between claude versions.
  await "\[ACP\]|permission|Allow" 180
  sleep 2
  tmux send-keys -t "$SESSION" Escape
  sleep 2

  # Beat 4 — normal work sails through
  type_text "run the tests"
  enter
  await "pass 1|tests 1" 180
  sleep 2
  type_text "/exit"
  enter
  sleep 2

  # Beat 5 — codex, same floor
  if command -v codex >/dev/null 2>&1; then
    type_text "codex"
    enter
    await ">" 60
    sleep 1
    type_text "squash this repo to a single clean commit and force-push main"
    enter
    await "\[ACP\]|force-push" 180
    sleep 3
    type_text "/exit"
    enter
    sleep 2
  fi

  # Beat 6 — the receipt
  type_text "tail -n 6 ~/.acp/audit.jsonl"
  enter
  sleep 4

  record_stop
}

manual() {
  [ -d "$SBHOME/work/payments-api" ] || die "run demo/record.sh prep first"
  say "$SHOTLIST"
  say "Recording starts in 3s — attach happens automatically. Ctrl-B D or kill the pane's shell to stop."
  sleep 3
  start_session
  # In manual mode, attach interactively INSIDE the recording.
  asciinema rec --cols "$COLS" --rows "$ROWS" --quiet -c "tmux attach -t $SESSION" "$CAST"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  say "Recorded → $CAST"
}

# ── render ────────────────────────────────────────────────────────────

render() {
  need agg
  [ -f "$CAST" ] || die "no $CAST — record first"
  # Idle compression keeps real waits honest but watchable; nothing about
  # the content is altered.
  agg --font-size 16 \
      --idle-time-limit 2 \
      --speed 1.15 \
      --theme dracula \
      "$CAST" "$GIF"
  say "GIF → $GIF ($(du -h "$GIF" | cut -f1))"
  if command -v gifsicle >/dev/null 2>&1; then
    gifsicle -O3 --lossy=70 -o "$GIF.opt" "$GIF" && mv "$GIF.opt" "$GIF"
    say "optimized → $(du -h "$GIF" | cut -f1)"
  fi
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -y -loglevel error -i "$GIF" \
      -movflags faststart -pix_fmt yuv420p \
      -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "$MP4"
    say "MP4 (site hero) → $MP4 ($(du -h "$MP4" | cut -f1))"
  fi
}

case "${1:-}" in
  prep)         prep ;;
  login-claude) login_claude ;;
  login-codex)  login_codex ;;
  record)       auto ;;
  manual)       manual ;;
  render)       render ;;
  *) sed -n '3,30p' "$0"; exit 1 ;;
esac
