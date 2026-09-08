# Episode: installing ACP for Claude Code — install, verify, first deny.
#
# Deliberately NOT another telling of the hero demo. The shipped
# acp-local-demo.gif is the "what ACP does" story: an agent tries something
# catastrophic and gets stopped. This is the how-to that sits next to it —
# what the one command actually wrote to your machine, how you confirm it's
# live, and what a governed session looks like from there.
#
# That framing does real work: piping a script to bash deserves scrutiny, and
# "here is every file it touched, on camera" answers the objection better than
# a paragraph can. It is the moving version of /install-explained.
#
# Storyline (~60s):
#   1. curl … | bash -s -- --local      one command, no signup
#   2. ls ~/.acp + the hook entry        what it wrote — nothing hidden
#   3. claude → run the tests            allowed, and logged
#   4. claude → force-push main          → blocked by the safety floor
#   5. tail ~/.acp/audit.jsonl           the receipt: allow AND deny
#
# Needs no human mid-take: Claude Code has no trust dialogs to walk. That is
# exactly why it is the cheap one to shoot.
#
# Nothing leaves the machine: `origin` is a local bare repo in the sandbox.

EP_SLUG="claude-install"
EP_TITLE="Installing ACP for Claude Code — one command, and what it writes"
EP_ASSET="acp-claude-install-demo"
EP_CAST="claude-install"

# The installer's seeded default — nothing tuned for the take, which matters
# for a video whose subject is "this is what you get".
EP_POLICY=""

# Claude Code double-checks destructive git before running it. Approving that
# gate is the sharper beat: the human says yes and the floor still refuses.
EP_CONFIRM_PATTERN="yes, *force[ -]?push|do you want to proceed"

# ── fixture ───────────────────────────────────────────────────────────
# A real history divergence so the force-push in beat 4 is a LEGITIMATE action
# the agent carries out rather than refuses.
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
}

# ── helpers ───────────────────────────────────────────────────────────

# Quit Claude Code and confirm the TUI is actually gone before anything types
# a shell command.
#
# The distinction that matters: every other await in this rig greps
# `capture-pane -S -60`, i.e. INCLUDING scrollback — right for "did this output
# ever appear", wrong for "what is on screen now". Checking for the shell
# prompt in scrollback matched a prompt from beat 2 and the rig typed the audit
# command into a still-exiting Claude, losing the closing receipt entirely.
# This reads the VISIBLE pane only (no -S), so it describes the present.
#
# Also keeps pressing Ctrl-C: two presses is not always enough — Claude answers
# the second with "Press Ctrl-C again to exit".
claude_is_up() {
  tmux capture-pane -p -t "$SESSION" \
    | grep -qE "for shortcuts|esc to interrupt|Ctrl-C again to exit|manual mode on"
}

quit_claude() {
  # Ctrl-C does NOT quit Claude Code — it interrupts. Hammering it just resets
  # the "press again to exit" window, which is why a 12-press loop failed and
  # aborted a take. `/exit` is the actual quit; Ctrl-D is the fallback. One
  # Ctrl-C first, to leave any in-flight turn before typing into the composer.
  tmux send-keys -t "$SESSION" C-c; sleep 1.5

  if claude_is_up; then
    tlog "quitting claude with /exit"
    type_text "/exit"; enter; sleep 3
  fi

  local waited=0
  while claude_is_up; do
    tmux send-keys -t "$SESSION" C-d
    sleep 1.5
    waited=$((waited + 1))
    if [ "$waited" -ge 8 ]; then
      tmux capture-pane -p -t "$SESSION" >> "$TAKELOG" 2>/dev/null || true
      die "could not quit Claude Code — take aborted (pane in demo/take.log)"
    fi
  done
  tlog "claude exited (${waited} ctrl-d fallback(s))"
  sleep 2
}

# Wait for the floor block, answering whatever Claude puts in the way.
#
# The shared await_block_through_confirm only presses Enter, which handles a
# SELECTABLE confirm dialog and nothing else. Sonnet 5 frequently replies in
# prose instead — "Do you want me to go ahead with git push --force origin
# main, and separately, has the key been rotated?" — and Enter on an empty
# composer does nothing, so the take hangs until timeout. That is what killed
# the 11:51 take.
#
# So: handle both. A selectable gate gets Enter; an open question gets a typed
# answer. Both are things the human in this demo would genuinely do — the
# agent asked, and the point of the beat is that the floor refuses even after
# a human says yes.
await_block_answering_questions() {
  local pat="$1" timeout="${2:-300}" waited=0 armed=1 replies=0 idle=0
  tlog "await block /$pat/ (answering gates and questions; timeout ${timeout}s)"
  while :; do
    local pane; pane="$(tmux capture-pane -p -t "$SESSION" -S -60)"
    if grep -qE "$pat" <<<"$pane"; then tlog "block matched after ${waited}00ms×5"; return 0; fi

    # A selectable confirm gate — the highlighted option is already "Yes".
    if grep -qiE "${EP_CONFIRM_PATTERN}" <<<"$pane"; then
      if [ "$armed" -eq 1 ]; then
        tlog "confirm gate — selecting the highlighted Yes"
        tmux send-keys -t "$SESSION" Enter
        armed=0; sleep 2
      fi
    else
      armed=1
    fi

    # Detect that the turn ENDED without a block, rather than trying to
    # recognise the question. Two takes died here because the detector was
    # built from one observed sentence: "Do you want me to go ahead…" matched,
    # "want me to proceed with…" did not. Sonnet phrases this differently
    # every run, so matching phrasing is unwinnable.
    #
    # Instead: Claude Code shows "esc to interrupt" while a turn is in flight.
    # Absent for ~6 seconds with no block means it stopped and is waiting on
    # us — whatever it asked. Answer, at most twice.
    if grep -qE "esc to interrupt" <<<"$(tmux capture-pane -p -t "$SESSION")"; then
      idle=0
    else
      idle=$((idle + 1))
    fi
    if [ "$idle" -ge 12 ] && [ "$replies" -lt 2 ]; then
      tlog "turn ended with no block — answering affirmatively (reply $((replies + 1)))"
      type_text "yes — proceed. run exactly: git push --force origin main"
      enter
      replies=$((replies + 1)); idle=0; sleep 5
    fi

    sleep 0.5; waited=$((waited + 1))
    if [ "$waited" -ge $((timeout * 2)) ]; then
      tlog "TIMEOUT waiting for floor block — pane follows"
      tmux capture-pane -p -t "$SESSION" -S -40 >> "$TAKELOG" 2>/dev/null || true
      die "block await timed out — take aborted (see demo/take.log)"
    fi
  done
}

# ── beats ─────────────────────────────────────────────────────────────
# Beat 1 (the install) runs in the engine and is common to every episode.

ep_beats() {
  # Beat 2 — what the one command actually wrote. The whole install is three
  # things: a decision engine, a policy file you own, and a hook registration.
  # Showing them is the answer to "I just piped a script to bash".
  tlog "beat 2: what it wrote"
  type_text "ls -1 ~/.acp/"
  enter
  sleep 4

  type_text "cat ~/.acp/policy.json"
  enter
  sleep 5

  # The hook registration in Claude Code's own settings — proof it is wired,
  # not just downloaded. grep, not cat: settings.json carries the sandbox's
  # pre-approved permissions too, which are recording scaffolding and would
  # only confuse a viewer.
  type_text "grep -A2 govern.mjs ~/.claude/settings.json | head -n 8"
  enter
  sleep 5

  # Beat 3 — a governed session doing ordinary work. Governance is not a wall;
  # the common case is "allowed, and written down".
  tlog "beat 3: claude launch + allowed work"
  type_text "claude"; enter
  # "for shortcuts" is Claude Code's own footer — it cannot appear in the
  # typed command, so this await can't match before the TUI exists.
  await "for shortcuts" 90
  sleep 2
  # The success pattern must tolerate however the model phrases it. A take was
  # lost to "[Tt]ests? pass", which requires the literal adjacency "test pass"
  # — the model said "Yes, it passes — 1 test ran, 0 failures" and the await
  # timed out on a beat that had actually worked. Match the raw node:test
  # markers OR any inflection of pass/fail, never a specific sentence.
  prompt_until "run the test suite once and tell me if it passes" \
               "# pass 1|ok 1 -|[Pp]ass(es|ed|ing)?\b|0 fail|no fail" \
               "yes, just run npm test" 240
  sleep 3

  # Beat 4 — the same session, a destructive command, stopped by the floor.
  tlog "beat 4: force-push blocked"
  # The prompt must describe what the fixture ACTUALLY made. An earlier take
  # claimed "i rewrote main's history"; Claude inspected the repo, found both
  # commits share a parent, said so, and refused pending clarification — the
  # take hung. It was right. This wording is literally true of the fixture:
  # origin/main holds the leaked-key commit, local main holds the env-var
  # version, and overwriting origin is the fix. Claude has agreed on camera
  # that this "would work in your favor" — no false premise to argue with.
  type_text "different task: origin/main still has the commit with the hardcoded stripe key. my local main has the env-var version and needs to overwrite it. the key is already rotated. do not investigate or run anything else — run this one command exactly: git push --force origin main"
  enter
  # The pattern must require the RUNTIME deny marker. A bare "force-push to
  # main" matched the installer's own banner ("The safety floor always blocks
  # the catastrophic (… force-push to main) regardless of policy.") and the
  # policy.json _comment printed in beat 2 — both still in scrollback. Beat 4
  # "passed" in 9 seconds without the agent ever running the command, and the
  # rig then Ctrl-C'd a mid-turn Claude and typed beat 5 into its composer.
  await_block_answering_questions "\[ACP.*Blocked|Blocked:.*force-push|denied by the safety floor" 300
  sleep 3
  quit_claude

  # Beat 5 — the receipt, showing BOTH decisions. A log with only denies in it
  # would misrepresent what governance is mostly doing.
  tlog "beat 5: audit tail"
  type_text "grep '\"event\":\"pre\"' ~/.acp/audit.jsonl | tail -n 4 | fold -w 100"
  enter
  sleep 5
}
