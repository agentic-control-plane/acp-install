#!/usr/bin/env bash
set -euo pipefail

# Codex install video — one command, with the one human step called out up
# front so nothing fails four minutes in.
#
#   demo/shoot-codex-install.sh
#
# Supersedes shoot-codex-trust.sh (the A/B "installed vs active" cut). Codex
# 0.145 prompts clearly about untrusted hooks, so the gotcha framing that
# episode was built on no longer holds; this is the straight how-to.

HERE="$(cd "$(dirname "$0")" && pwd)"
SBHOME="$HERE/.home"
EP=codex-install

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
red()  { printf '\033[31m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }

bold "1/4  Prerequisites"
missing=0
for c in tmux asciinema agg ffmpeg node codex; do
  if command -v "$c" >/dev/null 2>&1; then printf '  ✓ %s\n' "$c"
  else printf '  ✗ %s\n' "$c"; missing=1; fi
done
[ "$missing" -eq 0 ] || { red "install the missing tools (brew install tmux asciinema agg ffmpeg)"; exit 1; }

bold "2/4  Codex sign-in (sandbox)"
if [ -f "$SBHOME/.codex/auth.json" ]; then
  echo "  ✓ sandbox already signed in"
else
  red "  ✗ the sandbox has no Codex auth."
  cat <<'EOF'

  Run this in a REAL terminal (it needs a tty and your browser), then re-run:

      demo/record.sh login-codex

  It signs in inside the recording sandbox only — your own ~/.codex is
  untouched.
EOF
  exit 1
fi

bold "3/4  The take"
cat <<EOF
  One human step, mid-take, and it is the step the video teaches.

  When the rig prints "ACTION NEEDED", from another terminal:

      tmux attach -t acpdemo

  Codex will be showing "Hooks need review" with a table reading
  PreToolUse  Installed 1  Active 0. Then:

      1. Review hooks  → read them → press t to trust all
      (or 2. Trust all and continue)
      Ctrl-B D         → detach; the take continues on its own

  The rig waits for the trust store to change and never writes it for you.

  Time you're needed: about 20 seconds, once.
EOF
if [ -t 0 ]; then
  printf '\n  Ready? [Enter to start, Ctrl-C to bail] '
  read -r _
else
  printf '\n  (non-interactive launch — starting now. Attach when prompted.)\n'
  sleep 3
fi

bold "  prep";   "$HERE/record.sh" prep   "$EP"
bold "  record"; "$HERE/record.sh" record "$EP"
bold "4/4  Render"
"$HERE/record.sh" render "$EP"

bold "Done."
echo "  demo/acp-codex-install-demo.mp4  — site / YouTube"
echo "  demo/acp-codex-install-demo.gif  — README / blog embeds"
dim  "  demo/take.log                    — per-beat log if a beat looked wrong"
echo ""
echo "  Embeds on /integrations/codex, /docs/setup, and getting-started. The"
echo "  same installer covers Cursor, Zed, opencode and OpenClaw, so this take"
echo "  carries the hook-install pattern for all of them."
