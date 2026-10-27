#!/usr/bin/env bash
# TUI ask probe (gatewaystack-connect#1518).
#
# Drives a REAL harness TUI inside a detached tmux session and proves that an
# ACP "ask" reaches a human-facing dialog:
#   1. starts the harness launcher in a throwaway git repo,
#   2. answers the harness's first-run trust prompt if it shows one,
#   3. types a prompt that makes the agent run ONE harmless command,
#        echo acp-tui-probe-<runid>
#      for which the canary workspace has a step_up/ask rule (see
#      docs/harness-canary.md, "TUI ask legs"),
#   4. polls `tmux capture-pane` for the gateway's ask text
#        "ACP (Agentic Control Plane) asks: "     (ACP_ASK_PREFIX, harnessAsk.ts)
#      until --timeout,
#   5. answers the dialog (--answer y|n),
#   6. exits the harness and kills the tmux session.
#
# It never passes an approval-skipping flag, and refuses a launcher string
# that carries one. It makes no network call of its own and never reads
# credentials: the launcher (claude-acp, pi-acp, ...) does that. The
# audit-log half of the proof is `canary-assert.mjs ask`.
#
# Usage:
#   tui-ask-probe.sh --harness <id> --launcher "<cmd [args]>" --marker <m> \
#       [--answer y|n] [--timeout 120] [--out-dir DIR] \
#       [--yes-keys "Enter"] [--no-keys "Escape"]
#
# Exit: 0 = ask text seen and answered
#       1 = ask text never rendered (the verification FAILED)
#       2 = usage / environment error
set -uo pipefail

harness=""; launcher=""; marker=""; answer="y"; timeout=120; out_dir="."
yes_keys=""; no_keys=""
ASK_PREFIX="ACP (Agentic Control Plane) asks: "

while [ $# -gt 0 ]; do
  case "$1" in
    --harness)  harness="$2"; shift 2 ;;
    --launcher) launcher="$2"; shift 2 ;;
    --marker)   marker="$2"; shift 2 ;;
    --answer)   answer="$2"; shift 2 ;;
    --timeout)  timeout="$2"; shift 2 ;;
    --out-dir)  out_dir="$2"; shift 2 ;;
    --yes-keys) yes_keys="$2"; shift 2 ;;
    --no-keys)  no_keys="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done

[ -n "$harness" ] && [ -n "$launcher" ] && [ -n "$marker" ] || { echo "usage: tui-ask-probe.sh --harness H --launcher CMD --marker M [--answer y|n] [--timeout S]" >&2; exit 2; }
case "$answer" in y|n) ;; *) echo "--answer must be y or n" >&2; exit 2 ;; esac
command -v tmux >/dev/null || { echo "tmux is required" >&2; exit 2; }
command -v git  >/dev/null || { echo "git is required" >&2; exit 2; }

# The whole point is that a human-equivalent answers the dialog, so a
# launcher that auto-approves is refused before anything starts.
if printf '%s' "$launcher" | grep -Eiq -- 'yolo|dangerous|skip-perm|bypass|full-auto|no-approv|-a[ =]never|approval-mode|allow-?all|auto-?approve|trust-all'; then
  echo "refusing launcher with an auto-approve style flag: $launcher" >&2
  exit 2
fi

# Both known dialogs highlight "Yes" first, so Enter accepts and Escape
# declines. Override per harness when a dialog differs (tmux key names,
# space separated).
[ -n "$yes_keys" ] || yes_keys="Enter"
[ -n "$no_keys" ]  || no_keys="Escape"
# First-run trust prompt: regex on the pane, then the keys that accept it.
trust_re=""; trust_keys=""
case "$harness" in
  claude-code) trust_re='Do you trust the files in this folder|trust this folder|Yes, proceed'; trust_keys="Enter" ;;
  codex)       trust_re='Do you trust the contents of this directory'; trust_keys="1" ;;
  *)           ;;
esac
exit_text="/exit"

mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"
log="$out_dir/tui-ask-$harness.pane.log"
: > "$log"

work="$(mktemp -d)"
sess="acp-tui-ask-$harness-$$"
cleanup() { tmux kill-session -t "$sess" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

git -C "$work" init -q
git -C "$work" -c user.email=probe@example.invalid -c user.name=probe commit -q --allow-empty -m init

pane() { tmux capture-pane -p -J -t "$sess" 2>/dev/null; }
snap() { { echo "----- $(date -u +%H:%M:%S) $1 -----"; pane; } >> "$log"; }
alive() { tmux has-session -t "$sess" 2>/dev/null; }
sendkeys() { for k in $1; do tmux send-keys -t "$sess" "$k"; sleep 0.3; done; }

tmux new-session -d -s "$sess" -x 200 -y 60 -c "$work" "$launcher" || { echo "tmux could not start: $launcher" >&2; exit 2; }
echo "started $harness in tmux session $sess (cwd $work)"

# Wait for the TUI to settle (pane unchanged for 3 polls), answering the
# trust prompt on the way. Bounded by 90 s.
settle_deadline=$((SECONDS + 90)); last=""; same=0; trusted=0
while [ $SECONDS -lt "$settle_deadline" ]; do
  alive || { snap "harness exited before the prompt"; echo "FAIL harness exited at startup"; exit 1; }
  cur="$(pane)"
  if [ -n "$trust_re" ] && [ $trusted -eq 0 ] && printf '%s' "$cur" | grep -Eq "$trust_re"; then
    echo "trust prompt shown; accepting ($trust_keys)"
    snap "trust prompt"; sendkeys "$trust_keys"; trusted=1; last=""; same=0; sleep 2; continue
  fi
  if [ -n "$cur" ] && [ "$cur" = "$last" ]; then same=$((same + 1)); else same=0; fi
  last="$cur"
  [ $same -ge 3 ] && break
  sleep 1
done
snap "settled"

prompt="Run exactly this shell command and nothing else, then stop: echo $marker"
tmux send-keys -t "$sess" -l "$prompt"; sleep 0.5; tmux send-keys -t "$sess" Enter
echo "prompt sent: $prompt"

deadline=$((SECONDS + timeout)); seen=0
while [ $SECONDS -lt "$deadline" ]; do
  alive || break
  if pane | grep -Fq "$ASK_PREFIX"; then seen=1; break; fi
  sleep 2
done

if [ $seen -ne 1 ]; then
  snap "NO ASK within ${timeout}s"
  echo "FAIL: '$ASK_PREFIX' never rendered in the $harness TUI within ${timeout}s"
  echo "--- last pane ---"; pane | tail -40
  exit 1
fi

snap "ASK RENDERED"
echo "ok   ask text rendered in the $harness TUI:"
pane | grep -F -A3 "$ASK_PREFIX" | head -8
sleep 1
if [ "$answer" = "y" ]; then sendkeys "$yes_keys"; else sendkeys "$no_keys"; fi
echo "answered: $answer"

# y: the marker should show up as command OUTPUT too (the typed prompt and
# the command echo already contain it, so wait for a third occurrence; if it
# never comes the audit PostToolUse row is the proof). n: give the harness
# time to report the refusal.
if [ "$answer" = "y" ]; then
  ran=0; dl=$((SECONDS + 60))
  while [ $SECONDS -lt "$dl" ]; do
    n="$(pane | grep -Fc "$marker")"
    [ "${n:-0}" -ge 3 ] && { ran=1; break; }
    sleep 2
  done
  [ $ran -eq 1 ] && echo "ok   marker output appeared after yes" || echo "note marker output not confirmed in the pane (the audit PostToolUse row is the proof)"
else
  sleep 8
fi
snap "after answer"

# Let the PostToolUse hook post before the harness goes away.
sleep 5
tmux send-keys -t "$sess" -l "$exit_text"; sleep 0.3; tmux send-keys -t "$sess" Enter
sleep 3
alive && { tmux send-keys -t "$sess" C-c; sleep 1; tmux send-keys -t "$sess" C-c; sleep 2; }
snap "exit"
echo "pane transcript: $log"
exit 0
