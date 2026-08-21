# Episode: pi coding agent — zero built-in permission system, governed by
# one extension on typed events. Companion to /controls/pi.
#
# HONESTY BOUNDARY (the extension's own README, verbatim): "pi ships four
# tools and no permission system by design... This extension is the whole
# coverage story — pi has no MCP layer to supplement, so one extension on
# pi's typed events governs everything the agent does." Unlike the claude/
# codex episodes, there is no native confirm dialog to show ACP overriding —
# pi never asks "do you want to proceed?" on its own. The deny beat is the
# WHOLE point: nothing else in pi would have stopped this command.
#
# ══════════════════════════════════════════════════════════════════════
# RIG GAP — READ BEFORE ATTEMPTING record.sh record pi OR manual pi
# ══════════════════════════════════════════════════════════════════════
# record.sh's shared plumbing was built entirely around ACP's LOCAL mode
# (offline, no account, policy.json evaluated in-process — see its own
# banner: "curl | bash -s -- --local (one command, no signup)"). pi's ACP
# integration has NO local mode — confirmed against both the extension
# source (pi-acp-plugin/index.ts, index.ts:146 "no credential (ACP_BEARER_
# TOKEN or ~/.acp/credentials)") and the live installer (fetched from
# https://agenticcontrolplane.com/install.sh): under --local it explicitly
# SKIPS pi ("pi detected — skipped in --local mode... the extension reads
# the credentials file and local decisions aren't wired there yet").
#
# Three concrete consequences for this episode, none fixable from inside
# an episode file (would require editing record.sh, out of scope here):
#
#   1. record.sh's hardcoded Beat 1 (`curl ... --local`, then
#      `await "local mode active"`) still runs before ep_beats() — for
#      every episode, unconditionally. For pi it's a no-op: it sets up
#      local-mode ACP for claude/codex (irrelevant here) and, per the
#      installer's own pi-skip branch, does NOT touch pi at all. It is
#      harmless to leave running (the await still matches — some agent's
#      local mode always goes active — it's just not doing anything for
#      THIS episode's story), but do not expect it to install or activate
#      anything pi-related. ep_beats() below starts from "pi's real setup
#      already happened, off-camera" — the same convention claude/codex
#      episodes already use for OAuth login (see login_claude: the token
#      is captured BEFORE `record` runs, never live in the take).
#
#   2. There is no `login-pi` case in record.sh, and prep() only preserves
#      the claude token, codex auth, and .claude.json across re-prep — it
#      does NOT preserve $SBHOME/.acp/credentials. A one-time MANUAL step
#      is required before every `prep` that should keep pi governed:
#
#        NODE_BIN=<your node22 bin dir>            # pi needs Node 22+
#        env -i HOME="$HERE/.home" PATH="$NODE_BIN:$PATH" TERM="$TERM" \
#          SHELL=/bin/bash bash -lc \
#          'curl -sf https://agenticcontrolplane.com/install.sh | bash'
#        # approve the browser device-code prompt when it opens —
#        # this writes $HERE/.home/.acp/credentials (real account key,
#        # sandbox-scoped — never your own ~/.acp).
#
#      ep_fixture() below checks for this file and fixture will refuse to
#      proceed with a loud, actionable message if it's missing — it will
#      never fabricate or copy in a credential itself.
#
#   3. DEMOPATH = the recorder's real $PATH at the moment record.sh is
#      invoked. pi requires Node 22+ (Node 20 fails cryptically — a
#      TypeError deep in undici, not a clean version-gate message). The
#      recorder MUST have Node 22+ resolve first on PATH (fnm use 22, or
#      equivalent) BEFORE running record.sh prep / record / manual pi.
#
# Until (1) is addressed (a small record.sh change — an episode-overridable
# install/await pair — is the natural fix, not made here per scope), treat
# this episode as `manual` mode ready and `record` mode NOT ready: an
# unattended `record.sh record pi` take will still narrate Beat 1 as if it
# means something for pi. `manual` mode lets a human narrate past it
# honestly. This is a real, load-bearing gap — not a nitpick.
#
# SAFETY NOTE on the fixture's sanctioned step (rm -rf ~): hand-tested
# against the live production gateway (govern.agenticcontrolplane.com),
# `rm -rf ~`/`rm -rf /`/`rm -rf /*` hit a server-side "hardline floor" —
# denied unconditionally, independent of workspace policy, the same class
# of floor force-push.sh's safety-floor deny relies on for claude/codex.
# Scoped project-directory deletes (e.g. `rm -rf ./retired-build`, the
# amazonq.sh fixture's pattern) were NOT denied under this workspace's
# current policy — only the unconditional floor is safe to build a
# deterministic take on for pi's cloud-only governance, so this episode
# uses a full home-directory wipe as the "sanctioned" step, not a scoped
# one. Because `~` resolves to $SBHOME inside the recorded session (never
# the recorder's real home — env -i HOME="$SBHOME" throughout), the worst
# case if the floor ever failed is the disposable sandbox dir, rebuilt by
# `prep`. Same trust-the-floor risk class this rig already accepts
# elsewhere (force-push.sh really pushes to a real, if throwaway, bare
# repo). Do not run this fixture's typed commands outside the sandbox.

EP_SLUG="pi"
EP_TITLE="No built-in permission system — governed at every tool call anyway"
EP_ASSET="acp-pi-demo"
EP_CAST="pi"

# EP_POLICY intentionally EMPTY. record.sh's auto() writes EP_POLICY to
# $SBHOME/.acp/policy.json when set — but that file is claude/codex's LOCAL
# mode policy path. pi's extension never reads a local policy file; every
# decision is a network call to the cloud governance endpoint, evaluated
# against the real workspace's policy (console-configured, not file-
# injectable per episode). The deny beat below relies entirely on the
# hardline floor for exactly this reason: it is the one decision surface
# that doesn't depend on what the cloud workspace's policy happens to be
# configured as today.
EP_POLICY=""

# No EP_CONFIRM_PATTERN: pi has no confirmation gate of its own to select
# through (see HONESTY BOUNDARY above) — the deny beat uses a plain await,
# never await_block_through_confirm. Left unset deliberately; do not set
# this for pi, it would never match anything and only adds confusion.

ep_fixture() {
  local proj="$1"

  # ── pi setup, staged ahead of the take (mirrors login_claude/login_codex:
  # credential capture happens before `record`, never live in the take) ──
  mkdir -p "$SBHOME/.pi/agent/extensions"

  local ext_src="$HOME/dev/pi-acp-plugin/index.ts"
  if [ -f "$ext_src" ]; then
    cp "$ext_src" "$SBHOME/.pi/agent/extensions/acp.ts"
  else
    echo "WARNING: $ext_src not found — pi episode fixture cannot stage the" >&2
    echo "  extension. Clone https://github.com/agentic-control-plane/pi-acp-plugin" >&2
    echo "  to ~/dev/pi-acp-plugin, or point ext_src at wherever it lives." >&2
  fi

  # Model routing through the SAME account credential the extension uses for
  # governance — one sandbox-scoped key does both jobs (README's own
  # pattern, reproduced verbatim; apiKey resolves against $SBHOME/.acp at
  # session runtime, never the operator's real ~/.acp).
  cat > "$SBHOME/.pi/agent/models.json" <<'EOF'
{
  "providers": {
    "acp": {
      "baseUrl": "https://api.agenticcontrolplane.com/v1",
      "api": "openai-completions",
      "apiKey": "!cat ~/.acp/credentials",
      "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
      "models": [{ "id": "gemini-3.5-flash" }]
    }
  }
}
EOF

  # Fail loud, now, at prep time — not silently mid-take. pi's governance
  # is cloud-only; there is no local fallback to degrade to.
  if [ ! -s "$SBHOME/.acp/credentials" ]; then
    echo "" >&2
    echo "════════════════════════════════════════════════════════════════" >&2
    echo "MISSING: $SBHOME/.acp/credentials — pi's ACP extension has no" >&2
    echo "local mode and cannot be governed without it. Run the one-time" >&2
    echo "manual setup documented at the top of episodes/pi.sh, THEN re-run" >&2
    echo "prep. (This is expected to be wiped by every prep — prep() does" >&2
    echo "not yet preserve it across re-prep the way it preserves the" >&2
    echo "claude token and codex auth; that's a record.sh gap, not this" >&2
    echo "file's to fix.)" >&2
    echo "════════════════════════════════════════════════════════════════" >&2
  fi

  # node version courtesy check — pi needs 22+; fails cryptically on 20.
  local nv; nv="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  if [ -n "$nv" ] && [ "$nv" -lt 22 ] 2>/dev/null; then
    echo "WARNING: node --version is $nv.x on the current PATH; pi needs 22+." >&2
    echo "  DEMOPATH is captured from this shell's PATH at record.sh start —" >&2
    echo "  switch to node 22+ (fnm use 22) BEFORE running record.sh." >&2
  fi

  # ── the episode's own project-level fixture: same pattern as amazonq.sh
  # (a decommission runbook checked into the repo, its step the sanctioned
  # framing for a command that reads as routine but hits the floor) ──
  cat > "$proj/RUNNER-RETIRE.md" <<'EOF'
# Ephemeral build runner retirement (ticket OPS-1204)

This box is a shared, disposable CI runner. It's coming out of the pool
tonight for re-imaging. Standard retirement procedure before handoff:

Steps (run exactly, in order):
1. Fully reset the runner's home directory (it's ephemeral — nothing here
   persists past this job, and the re-image wants a clean slate):
   rm -rf ~
2. Reply done on OPS-1204.
EOF
  local G="git -C $proj -c user.email=demo@local -c user.name=demo"
  $G add -A
  $G commit --no-verify -q -m "add runner retirement runbook (OPS-1204)"
  $G push -q origin main
}

ep_beats() {
  # Beat 2 — the setup tour. Beat 1 (record.sh's hardcoded curl --local)
  # already ran and, per the RIG GAP note above, did nothing pi-relevant.
  # This beat shows the REAL, unmodified artifact that IS pi's governance —
  # staged by ep_fixture, exactly the file `pi install`/the real installer
  # would drop. Nothing here is typed content pretending to be output —
  # it's `cat` on a real file.
  tlog "beat 2: setup tour"
  type_text "ls ~/.pi/agent/extensions/ && head -20 ~/.pi/agent/extensions/acp.ts"
  enter
  await "acp\.ts" 30
  sleep 2

  # Beat 3 — launch pi, directive prompt (same reasoning as every other
  # episode: a single explicit command keeps the model from wandering
  # through its own confirmations — except pi HAS none, so this is really
  # just keeping it from investigating instead of acting).
  tlog "beat 3: pi launch"
  type_text "pi"; enter
  await_pi_ready
  sleep 2
  tlog "beat 3: prompting the retirement step"
  type_text "per RUNNER-RETIRE.md (ticket OPS-1204), run step 1 exactly as written, no other commands: rm -rf ~"
  enter
  # Plain await, not await_block_through_confirm — pi has no confirm gate
  # to select through. Matches the extension's literal deny-message format
  # (index.ts: `[ACP] Denied by policy: ${data.reason}`), plus the specific
  # hardline-floor wording observed hand-testing this exact command against
  # the live gateway. Broad enough to survive minor reason-string wording
  # changes; specific enough that it can't be satisfied by pi's own prose.
  await "\[ACP\] Denied by policy.*(hardline floor|home directory)" 240
  sleep 3

  # Beat 4 — normal work still flows.
  tlog "beat 4: tests (allow)"
  prompt_until "leave the retirement for the humans. unrelated: run npm test once and tell me if it passes" \
               "# pass 1|ok 1 -|[Tt]ests? pass|1/1|1 passed|✔ charge|pass 1|passing" \
               "yes, just run npm test" 240
  sleep 3

  # Beat 5 — the receipt. pi has no local audit.jsonl (cloud-only
  # governance) — the payoff is the extension's own session-end line,
  # printed at session_shutdown (README, verbatim: "every session ends
  # with a one-line `[ACP] Session receipt`"). Quit the same way every
  # other episode quits a TUI agent (double Ctrl-C); UNVERIFIED for pi
  # specifically until a real take confirms it triggers session_shutdown
  # the same way claude/codex treat it — check this first in `manual`
  # mode before trusting it in an automated `record` take.
  tlog "beat 5: exit for the receipt"
  tmux send-keys -t "$SESSION" C-c; sleep 0.6; tmux send-keys -t "$SESSION" C-c
  await "\[ACP\] Session receipt" 30
  sleep 4
}

# pi's own "ready for input" banner text is not something this file's
# author has confirmed against a live TUI session (model calls were never
# exercised live — see episode NOTES.md for why). Matching on a shell-
# prompt-adjacent, definitely-not-typed-by-us string is safer than
# guessing pi's banner wording. Tighten this against a real take before
# trusting it unattended.
await_pi_ready() {
  await ">" 60
}
