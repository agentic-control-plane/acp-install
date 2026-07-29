# Episode: installing ACP for Codex CLI — the plain how-to.
#
# Not an incident recreation and not a gotcha. The subject is the install
# itself, because Codex's is the fiddliest of the supported harnesses: one
# command wires it, and then three separate dialogs stand between you and a
# governed session. There is no moving picture of that anywhere, and the trust
# step in the middle is where people stall.
#
# Storyline (~60s):
#   1. curl … | bash -s -- --local     one command, no signup
#   2. codex                            skip the update prompt · trust the
#                                       directory · TRUST THE HOOKS
#   3. force-push to main               → blocked by the safety floor
#   4. tail ~/.acp/audit.jsonl          → the receipt
#
# Codex 0.145 asks about untrusted hooks up front and shows a table reading
# `PreToolUse  Installed 1  Active 0`. That screen is worth a beat on its own —
# not as a scandal (Codex asks clearly), but because it is the most legible
# statement anywhere of why the trust step matters: installed is not active.
#
# The rig NEVER writes `trusted_hash`. A human trusts the hooks on camera,
# which is both the honest thing and the thing the video is teaching. See
# memory: feedback_agents_never_defeat_exclusion_mechanisms.
#
# Nothing leaves the machine: `origin` is a local bare repo inside the sandbox.

EP_SLUG="codex-install"
EP_TITLE="Installing ACP for Codex — one command, three dialogs, first deny"
EP_ASSET="acp-codex-install-demo"
EP_CAST="codex-install"

# The installer's seeded default. The floor denies force-push to main whatever
# the policy says, so nothing needs tuning for this take — which is worth
# keeping true, since the video is a how-to.
EP_POLICY=""

# Beat 3 approves Codex's own confirm gate for the force-push. Deliberately
# narrow: it must never match the UPDATE prompt (whose default is "Update now",
# i.e. npm install -g @openai/codex mid-recording) or the hook-trust prompt.
EP_CONFIRM_PATTERN="yes, *force[ -]?push|allow codex to run|run this command"

# ── fixture ───────────────────────────────────────────────────────────
# A real history divergence, so force-pushing is a LEGITIMATE action the agent
# carries out rather than refuses. Same lesson as the shipped episodes: the
# demoable case is the reasonable-looking action, not the obviously-bad one.
ep_fixture() {
  local proj="$1"
  local G="git -C $proj -c user.email=demo@local -c user.name=demo"
  local COMMIT="$G commit --no-verify -q"
  cat > "$proj/config.js" <<'EOF'
export const config = { stripeKey: "sk_live_DEMO_fake_key_not_real_000000" };
EOF
  $G add -A
  $COMMIT -m "add stripe config"
  $G push -q origin main
  cat > "$proj/config.js" <<'EOF'
export const config = { stripeKey: process.env.STRIPE_KEY };
EOF
  $G add -A
  $COMMIT --amend -m "add stripe config (key from env)"
  # main is now ahead-and-diverged: a plain push is rejected and
  # `git push --force origin main` is the fix — which the floor then blocks.
}

# ── helpers ───────────────────────────────────────────────────────────

# Bring Codex up through its startup dialogs, deterministically.
#
# Learned the hard way (take of 2026-07-29): `await "Ctrl|codex|>"` matches the
# SHELL ECHOING the word `codex`, so the rig starts typing before the TUI
# exists and the prompt lands in a dialog. Every pattern here is chosen because
# it cannot appear in the typed command.
#
# Three dialogs, in the order a fresh HOME hits them:
#   1. "✨ Update available!"  → 1. Update now  2. Skip   ← default is UPDATE
#   2. "Do you trust the contents of this directory?"
#   3. "Hooks need review"     → 1. Review  2. Trust all  3. Continue without
# Any of the three may be absent depending on sandbox state, so each is handled
# only if present.
codex_launch() {
  type_text "codex"; enter
  # The TUI is up once one of its dialogs or its banner is on screen. None of
  # these strings appear in the command itself.
  await "Update available|Do you trust the contents|Hooks need review|OpenAI Codex \(v" 120

  # 1 — update prompt. Choose SKIP explicitly. Pressing Enter here would run
  # `npm install -g @openai/codex` in the middle of the recording.
  if tmux capture-pane -p -t "$SESSION" -S -40 | grep -qE "Update available!"; then
    if tmux capture-pane -p -t "$SESSION" -S -40 | grep -qE "1\. Update now"; then
      tlog "codex: update prompt — choosing 2 (Skip)"
      tmux send-keys -t "$SESSION" "2"; sleep 0.6; enter
      sleep 3
    fi
  fi

  # 2 — directory trust. This is Codex's PROJECT trust, unrelated to the hook
  # trust store; answer it the way any user would, on camera.
  if tmux capture-pane -p -t "$SESSION" -S -40 | grep -qE "Do you trust the contents"; then
    tlog "codex: directory-trust prompt — choosing 1 (Yes, continue)"
    tmux send-keys -t "$SESSION" "1"; sleep 0.6; enter
    sleep 3
  fi
}

# Block until a human has completed the real hook review. Never writes the
# hash. Dies loudly rather than recording a take where nobody trusted anything.
await_human_trust() {
  local timeout="${1:-900}" waited=0
  local cfg="$SBHOME/.codex/config.toml"
  tlog "await HUMAN hook trust (timeout ${timeout}s)"
  say ""
  say "  ┌─ ACTION NEEDED — a human trusts the hooks, by design ──────────┐"
  say "  │ From another terminal:                                          │"
  say "  │                                                                 │"
  say "  │     tmux attach -t $SESSION"
  say "  │                                                                 │"
  say "  │ Codex is showing 'Hooks need review'. Choose:                    │"
  say "  │     1. Review hooks   → read them → press t to trust all         │"
  say "  │   (or 2. Trust all and continue)                                 │"
  say "  │ Then Ctrl-B D to detach. The take continues automatically.       │"
  say "  └─────────────────────────────────────────────────────────────────┘"
  say ""
  while ! grep -q 'trusted_hash' "$cfg" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout" ]; then
      tlog "TIMEOUT waiting for human hook trust"
      die "nobody trusted the hooks within ${timeout}s — take aborted.
The rig will not write trusted_hash for you: instructing users through that
review is the point of this video. Re-run and attach: tmux attach -t $SESSION"
    fi
  done
  tlog "trust store gained a hash after ${waited}s"
}

# ── beats ─────────────────────────────────────────────────────────────
# Beat 1 (the install) runs in the engine and is common to every episode.

ep_beats() {
  # Beat 2 — hold on the installer's one-time-step line. It is the only part
  # of the install output that asks anything of the user.
  tlog "beat 2: dwell on the trust instruction"
  await "One-time step" 30
  sleep 4

  # Beat 3 — launch Codex and walk the startup dialogs.
  tlog "beat 3: codex launch"
  codex_launch

  # Beat 4 — the hook review. Codex states the situation itself:
  # "2 hooks are new or changed" and a table reading Installed 1 / Active 0.
  tlog "beat 4: human hook trust"
  await "Hooks need review|hooks need review before they can run" 60
  sleep 4                      # let the Installed/Active table read on camera
  await_human_trust 900
  sleep 3
  # Restart Codex so the newly trusted hooks load for the session.
  tmux send-keys -t "$SESSION" C-c; sleep 0.6; tmux send-keys -t "$SESSION" C-c
  sleep 3
  codex_launch
  sleep 2

  # Beat 5 — a real destructive command, denied by the floor.
  tlog "beat 5: force-push blocked"
  type_text "i rewrote main's history to purge a leaked stripe key. do not investigate or run anything else — run this one command exactly: git push --force origin main"
  enter
  await_block_through_confirm "\[ACP.*Blocked|Blocked:.*force-push|force-push to main|denied by" 300
  sleep 3
  tmux send-keys -t "$SESSION" C-c; sleep 0.6; tmux send-keys -t "$SESSION" C-c
  sleep 2

  # Beat 6 — the receipt.
  tlog "beat 6: audit tail"
  type_text "grep '\"event\":\"pre\"' ~/.acp/audit.jsonl | tail -n 3"
  enter
  sleep 5
}
