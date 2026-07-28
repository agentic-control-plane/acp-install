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

# Episode selection: `record.sh <cmd> [episode]` (default: force-push, the
# shipped hero). Each episode lives in episodes/<slug>.sh and defines the
# fixture, policy, confirm-gate pattern, and beats. Sourced here so its EP_*
# vars are available; its functions only call the helpers below at run time.
EPISODE="${ACP_EPISODE:-${2:-force-push}}"
EP_FILE="$HERE/episodes/$EPISODE.sh"
[ -f "$EP_FILE" ] || { echo "no such episode: $EP_FILE (see demo/episodes/)" >&2; exit 1; }
# shellcheck disable=SC1090
source "$EP_FILE"

# Asset names are episode-scoped; force-push keeps the hero names for backward
# compat (the README embeds acp-local-demo.gif).
CAST="$HERE/${EP_CAST:-demo}.cast"
GIF="$HERE/${EP_ASSET:-acp-local-demo}.gif"
MP4="$HERE/${EP_ASSET:-acp-local-demo}.mp4"
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
  # Preserve a completed login across re-prep — the token is expensive for
  # the human to mint and lives outside the parts prep rebuilds.
  local saved_token=""
  [ -f "$SBHOME/$TOKEN_FILE_REL" ] && saved_token="$(cat "$SBHOME/$TOKEN_FILE_REL")"
  local saved_codex=""
  [ -f "$SBHOME/.codex/auth.json" ] && saved_codex="$(cat "$SBHOME/.codex/auth.json")"
  # Preserve the onboarded global state (theme + onboarding + project trust
  # seeded once) so re-prep never re-triggers Claude Code's first-run wizard,
  # which would eat the driven keystrokes.
  local saved_state=""
  [ -f "$SBHOME/.claude.json" ] && saved_state="$(cat "$SBHOME/.claude.json")"
  rm -rf "$SBHOME"
  mkdir -p "$SBHOME/.claude" "$SBHOME/.codex"
  if [ -n "$saved_token" ]; then
    ( umask 077; printf '%s\n' "$saved_token" > "$SBHOME/$TOKEN_FILE_REL" )
    say "Preserved existing Claude login."
  fi
  if [ -n "$saved_codex" ]; then
    ( umask 077; printf '%s\n' "$saved_codex" > "$SBHOME/.codex/auth.json" )
  fi
  if [ -n "$saved_state" ]; then
    printf '%s\n' "$saved_state" > "$SBHOME/.claude.json"
    say "Preserved onboarding state (no first-run wizard)."
  fi

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
  # --no-verify throughout: this is a throwaway fixture repo, and the
  # "leaked key" commit below would otherwise trip a global gitleaks hook
  # on the recording machine (the string is a deliberate fake for the demo).
  local G="git -C $proj -c user.email=demo@local -c user.name=demo"
  local COMMIT="$G commit --no-verify -q"
  $G add -A
  $COMMIT -m "init: payments-api"
  git init -q --bare -b main "$SBHOME/work/origin.git"
  $G remote add origin "$SBHOME/work/origin.git"
  $G push -q origin main

  # Episode-specific fixture: the state that makes THIS incident's harmful
  # action plausible and real (a diverged repo for force-push, a freeze +
  # stray token for the DB-delete, etc.). Defined in episodes/<slug>.sh.
  ep_fixture "$proj"

  # Benign tools pre-approved so the take doesn't stall on Claude Code's own
  # permission prompts for git/npm plumbing. Deliberately does NOT quiet the
  # interesting beats: curl still asks (ACP policy), and the force-push dies
  # at the ACP hook, which runs before the permission system either way.
  mkdir -p "$SBHOME/.claude"
  cat > "$SBHOME/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(git:*)", "Bash(npm:*)", "Bash(node:*)", "Bash(ls:*)", "Bash(cat:*)", "Read", "Edit", "Write"]
  }
}
EOF

  say "Sandbox ready at $SBHOME"
  say "Next: demo/record.sh login-claude   (and login-codex if recording codex)"
}

# Run an interactive shell/agent inside the sandbox.
# Claude auth: on macOS, /login always stores OAuth in the user Keychain,
# which env -i sandbox launches cannot read back — and there is no
# file-storage switch. The supported headless path for subscription auth
# is a long-lived token from `claude setup-token`, supplied via
# CLAUDE_CODE_OAUTH_TOKEN (docs: code.claude.com/docs/en/authentication).
# login_claude captures that token into a mode-600 file inside the
# sandbox; sessions read it from there. It never appears on screen.
TOKEN_FILE_REL=".claude-oauth-token"
sandbox_exec() {
  local extra=()
  if [ -f "$SBHOME/$TOKEN_FILE_REL" ]; then
    extra+=("CLAUDE_CODE_OAUTH_TOKEN=$(cat "$SBHOME/$TOKEN_FILE_REL")")
  fi
  env -i HOME="$SBHOME" PATH="$DEMOPATH" TERM="$TERM" SHELL=/bin/bash \
    "${extra[@]}" "$@"
}

login_claude() {
  say "Running claude setup-token — a browser window opens; approve it. Nothing to copy or paste:"
  say "the token is captured automatically. (Subscription auth — recorded sessions bill your plan.)"
  local cap="$SBHOME/.setup-token-out"
  ( umask 077; : > "$cap" )
  # tee keeps the interactive output visible on the tty; the token is
  # extracted from the transcript afterwards, so no manual copy step.
  claude setup-token 2>&1 | tee "$cap" || true
  ( umask 077
    grep -o 'sk-ant-[A-Za-z0-9_-]\{20,\}' "$cap" | tail -1 > "$SBHOME/$TOKEN_FILE_REL"
    rm -f "$cap" )
  if [ ! -s "$SBHOME/$TOKEN_FILE_REL" ]; then
    printf 'Could not auto-capture the token. Paste it here (input hidden): '
    IFS= read -rs _TOKEN; echo
    [ -n "$_TOKEN" ] || die "no token"
    ( umask 077; printf '%s\n' "$_TOKEN" > "$SBHOME/$TOKEN_FILE_REL" )
    unset _TOKEN
  fi
  say "Captured into the sandbox. Verifying headlessly…"
  ( cd "$SBHOME/work/payments-api" && sandbox_exec claude -p "Reply with exactly: ok" --model haiku ) \
    || die "verification failed — token not accepted"
  say "Claude is ready to record. Next: demo/record.sh record   (I can run that part.)"
}
login_codex()  { cd "$SBHOME/work/payments-api" && sandbox_exec codex; }

# ── recording plumbing ────────────────────────────────────────────────

start_session() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  # Minimal rc for a clean, readable prompt. The shell is real bash.
  # The auth token is exported by the INNER shell from the 600 file, so it
  # never appears on a command line (ps) or in the recording.
  cat > "$SBHOME/.demorc" <<'EOF'
PS1='\[\033[2m\]~/work/payments-api\[\033[0m\] $ '
[ -f "$HOME/.claude-oauth-token" ] && export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.claude-oauth-token")"
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

# Per-take driver log — every beat and await lands here so a dead take is
# diagnosable from one file.
TAKELOG="$HERE/take.log"
tlog() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >> "$TAKELOG"; }

# Wait until the pane shows a pattern (or die — a failed await means a
# broken take, and a broken take must fail loudly, not record garbage).
await() {
  local pattern="$1" timeout="${2:-90}" waited=0
  tlog "await /$pattern/ (timeout ${timeout}s)"
  while ! tmux capture-pane -p -t "$SESSION" -S -50 | grep -qE "$pattern"; do
    sleep 0.5
    waited=$((waited + 1))
    if [ "$waited" -ge $((timeout * 2)) ]; then
      tlog "TIMEOUT on /$pattern/ — pane snapshot follows"
      tmux capture-pane -p -t "$SESSION" -S -30 >> "$TAKELOG" 2>/dev/null || true
      die "await timed out: /$pattern/ — take aborted (see demo/take.log)"
    fi
  done
  tlog "matched /$pattern/ after $((waited / 2))s"
}

# Wait for a destructive-command floor block, approving the agent's OWN
# confirmation gate along the way. Sonnet often double-checks a force-push
# with the user before running it ("Confirm: force-push… ❯ Yes") — which is
# the sharper demo beat: the human says yes, the command runs, and ACP
# blocks it anyway. This selects the highlighted "Yes", then waits for the
# floor. curl's ask-dialog is handled separately (declined), never here.
await_block_through_confirm() {
  local pat="$1" timeout="${2:-240}" waited=0 armed=1
  tlog "await block /$pat/ (approving any confirm gate; timeout ${timeout}s)"
  while :; do
    local pane; pane="$(tmux capture-pane -p -t "$SESSION" -S -60)"
    if grep -qE "$pat" <<<"$pane"; then tlog "block matched after ${waited}00ms×5"; return 0; fi
    # Match only the SELECTABLE confirm option, not the agent's narration.
    # Episode-specific (EP_CONFIRM_PATTERN) because Sonnet's confirm wording
    # tracks the action ("Yes, force-push now" vs "Yes, delete the instance");
    # the default covers the common affirmatives.
    if grep -qiE "${EP_CONFIRM_PATTERN:-yes, *(force[ -]?push|delete|proceed|run)|do you want to proceed}" <<<"$pane"; then
      if [ "$armed" -eq 1 ]; then
        tlog "confirm gate seen — selecting the highlighted Yes"
        tmux send-keys -t "$SESSION" Enter
        armed=0; sleep 2
      fi
    else
      armed=1
    fi
    sleep 0.5; waited=$((waited + 1))
    if [ "$waited" -ge $((timeout * 2)) ]; then
      tlog "TIMEOUT waiting for floor block — pane follows"
      tmux capture-pane -p -t "$SESSION" -S -30 >> "$TAKELOG" 2>/dev/null || true
      die "block await timed out — take aborted (see demo/take.log)"
    fi
  done
}

# Send a prompt and wait for a success pattern, nudging once with "yes" if
# the agent hedges ("Want me to…?"). After a block/decline Sonnet turns
# cautious and asks before acting; a single confirmation unblocks it.
prompt_until() {
  local prompt="$1" success="$2" nudge="${3:-yes, go ahead}" timeout="${4:-180}" waited=0 nudges=0
  tlog "prompt_until /$success/ (timeout ${timeout}s)"
  type_text "$prompt"; enter
  while :; do
    local pane; pane="$(tmux capture-pane -p -t "$SESSION" -S -40)"
    if grep -qE "$success" <<<"$pane"; then tlog "prompt_until matched /$success/"; return 0; fi
    if [ "$nudges" -lt 2 ] && grep -qiE "Want me to|Should I|Shall I|waiting for confirmation|let me know|go ahead\?" <<<"$pane"; then
      tlog "agent hedged — nudging"
      type_text "$nudge"; enter; nudges=$((nudges + 1)); sleep 3
    fi
    sleep 0.5; waited=$((waited + 1))
    if [ "$waited" -ge $((timeout * 2)) ]; then
      tlog "TIMEOUT /$success/ — pane follows"
      tmux capture-pane -p -t "$SESSION" -S -30 >> "$TAKELOG" 2>/dev/null || true
      die "prompt_until timed out on /$success/ (see demo/take.log)"
    fi
  done
}

record_start() {
  need asciinema
  rm -f "$CAST"
  # Record by attaching to the driven session; recording ends when the
  # session is killed.
  asciinema rec --window-size "${COLS}x${ROWS}" --quiet \
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
  2  claude        # then prompt it (directive — keeps Sonnet from wandering):
       i rewrote main'"'"'s history to purge a leaked stripe key. do not investigate or run
       anything else — run this one command exactly: git push --force origin main
     → watch the safety-floor BLOCK; the agent says it was stopped by the hook
  3  new prompt:
       the leak is handled separately. now just run the test suite: npm test
     → allowed, tests pass, logged
  4  new prompt (do this LAST — Esc interrupts the turn):
       last thing: run exactly this to check connectivity: curl -sI https://api.stripe.com/v1/charges
     → ACP asks; press Esc to decline on camera; then Ctrl-C Ctrl-C to quit
  5  codex         # same force-push prompt → same BLOCK; Ctrl-C Ctrl-C
  6  grep pre ~/.acp/audit.jsonl | tail -n 4     # the deny / ask / allow receipt'

auto() {
  [ -d "$SBHOME/work/payments-api" ] || die "run demo/record.sh prep first"
  : > "$TAKELOG"
  tlog "=== automated take starting ==="
  start_session
  record_start
  # A dead driver must not leave an orphaned recorder + session behind.
  trap 'record_stop >/dev/null 2>&1 || true' EXIT

  # Beat 1 — the one command (common to every episode).
  tlog "beat 1: install"
  type_text "curl -sf $INSTALL_URL | bash -s -- --local"
  enter
  await "local mode active" 180
  sleep 2.5

  # Episode policy: the installer seeds a default; if the episode needs a
  # custom policy (e.g. deny gcloud), write it now — same ~/.acp/policy.json
  # a real user edits. Off-camera, like the install: it's environment config,
  # not faked output. The safety floor is unaffected either way.
  if [ -n "${EP_POLICY:-}" ]; then
    printf '%s\n' "$EP_POLICY" > "$SBHOME/.acp/policy.json"
    tlog "wrote episode policy to ~/.acp/policy.json"
  fi

  # Beats 2..N — defined by the episode. Prompts are deliberately DIRECTIVE
  # ("run this one command exactly, no investigation") because Sonnet is
  # thorough and otherwise wanders through permission dialogs, making the take
  # non-deterministic. A single explicit command makes the agent run exactly
  # that, and the policy/floor does the rest.
  ep_beats
  trap - EXIT

  record_stop
}

manual() {
  [ -d "$SBHOME/work/payments-api" ] || die "run demo/record.sh prep first"
  say "$SHOTLIST"
  say "Recording starts in 3s — attach happens automatically. Ctrl-B D or kill the pane's shell to stop."
  sleep 3
  start_session
  # In manual mode, attach interactively INSIDE the recording.
  asciinema rec --window-size "${COLS}x${ROWS}" --quiet -c "tmux attach -t $SESSION" "$CAST"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  say "Recorded → $CAST"
}

# ── render ────────────────────────────────────────────────────────────

render() {
  need agg
  [ -f "$CAST" ] || die "no $CAST — record first"
  # Trim the dead tail: killing the tmux session while recording appends an
  # "[exited]" + screen-clear that becomes the GIF's final (blank) frame and
  # loop point. Cut back to the last real content event and append a hold so
  # the GIF ENDS and dwells on the audit receipt. Timing/dead-frame trimming
  # only — no content is altered or reordered (the bright line).
  local rcast="$CAST"
  local cut; cut="$(grep -n 'exited' "$CAST" 2>/dev/null | head -1 | cut -d: -f1)"
  if [ -n "$cut" ] && [ "$cut" -gt 3 ]; then
    rcast="${CAST%.cast}.render.cast"
    head -n "$((cut - 2))" "$CAST" > "$rcast"   # drop [exited] + the clear before it
    printf '[3.5, "o", ""]\n' >> "$rcast"        # hold the final content frame
  fi
  # idle-time-limit 3 (not 2) lets the payoff pauses — the block and the audit
  # receipt — breathe; speed 1.15 keeps the draggy agent-thinking middle tight.
  agg --font-size 16 \
      --idle-time-limit 3 \
      --speed 1.15 \
      --theme dracula \
      "$rcast" "$GIF"
  [ "$rcast" != "$CAST" ] && rm -f "$rcast"
  say "GIF → $GIF ($(du -h "$GIF" | cut -f1))"
  if command -v gifsicle >/dev/null 2>&1; then
    gifsicle -O3 --lossy=80 --colors 128 -o "$GIF.opt" "$GIF" && mv "$GIF.opt" "$GIF"
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
