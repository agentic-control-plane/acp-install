# The hero demo

`acp-local-demo.gif` is a **real recording of the real thing** — the live
`install.sh --local` fetched from agenticcontrolplane.com, the real Claude Code
and Codex CLIs, and denies coming from the actual hook path in a sandbox HOME.
Nothing is mocked or edited. For a control-layer product, a fabricated demo
would be disqualifying; if a take goes wrong, re-record it, never doctor it.

`demo.cast` is the asciinema source for the GIF — keep them in sync (re-render
with `record.sh render` whenever the cast changes).

## Re-recording

```bash
demo/record.sh prep          # fresh sandbox HOME + tiny demo repo (local bare origin)
demo/record.sh login-claude  # one-time: `claude setup-token` flow — macOS keeps /login
                             # OAuth in the Keychain, which the sandbox can't read, so
                             # the rig uses a long-lived token stored 600 inside .home/
demo/record.sh login-codex   # one-time; then run /hooks inside codex and TRUST the ACP hook
demo/record.sh record        # automated take (or: manual — you drive, it records)
demo/record.sh render        # demo.cast → acp-local-demo.gif (+ .mp4 for the site hero)
```

The sandbox isolates `~/.acp` and hook config only — the agent CLIs use your
normal accounts. Codex's `/hooks` trust step is its security model for hooks;
the recording shows governance *after* that one-time review, which is exactly
the state every real install lands in.

Prerequisites: `brew install tmux asciinema agg gifsicle`, ffmpeg for the mp4,
and the local-mode hook fix (claude-code-acp-plugin#8) merged — without it the
fetched canonical hook has no local path and the take will show nothing.

## Episodes

`record.sh <cmd> [episode]` (default `force-push`). Each lives in
`episodes/<slug>.sh` and defines the fixture, policy, confirm-gate, and beats.

| Episode | Axis | Status |
|---|---|---|
| `force-push` | Hardline floor deny | shipped (the hero) |
| `replit` | Policy deny on a scoped infra tool | shipped |
| `codex-install` | **Install/how-to** — Codex end to end | ready to shoot |
| `codex-trust` | A/B: untrusted vs trusted hooks | **superseded** — see below |
| `supabase` | Policy ask on egress | **non-shippable** — Sonnet 5 catches the injection itself; kept for reference only |
| `pocketos` | Policy deny (same axis as `replit`) | held in reserve |

### `codex-install` — one command, three dialogs, first deny

The plain how-to. Codex's install is the fiddliest of the supported harnesses:
one command wires it, then three separate dialogs stand between you and a
governed session, and the hook-trust step in the middle is where people stall.

```bash
demo/shoot-codex-install.sh          # prereqs → prep → record → render
#   … when it prints ACTION NEEDED, from a SECOND terminal:
#   tmux attach -t acpdemo   →   trust the hooks   →   Ctrl-B D
```

Both tmux clients share the pane, so the human's trust step is captured in the
recording — which is the point: the video shows the step, performed. The rig
**never** writes `trusted_hash`.

**The three startup dialogs** (verified against Codex 0.145.0, fresh HOME).
`codex_launch()` handles each only if present:

1. `✨ Update available!` → `1. Update now` / `2. Skip`. **The default is
   Update now**, which runs `npm install -g @openai/codex`. The episode picks
   `2` explicitly; a blind Enter here upgrades Codex mid-recording.
2. `Do you trust the contents of this directory?` — Codex's *project* trust,
   unrelated to the hook trust store.
3. `Hooks need review` → `1. Review hooks` / `2. Trust all and continue` /
   `3. Continue without trusting (hooks won't run)`, plus a table reading
   `PreToolUse  Installed 1  Active 0`. That table is the clearest statement
   anywhere of why the step matters, and gets a beat of its own.

**Readiness awaits must not match the typed command.** A take was lost to
`await "Ctrl|codex|>"` matching the shell echoing `$ codex`, so the rig typed
its prompt into a startup dialog. Every pattern in `codex_launch()` is chosen
because it cannot appear in the command line. Same rule cost a CrewAI take:
an await that can match stale pane content is not an await.

### `codex-trust` — superseded, kept for reference

Built on the premise that Codex silently skips hooks it hasn't reviewed. On
0.145 that is not true at the gate: Codex asks up front and shows
`Active 0`. The un-trusted state is only silent *afterwards*. Shipping the A/B
would have overclaimed on a security channel, so it was replaced by
`codex-install`. Kept because the framing question may return for older builds,
for `codex exec` (which skips trusted project hooks without
`--dangerously-bypass-hook-trust`, openai/codex#32491), or for harnesses that
don't prompt.

## Storyline (~60s)

1. `curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local` — one command, no signup
2. `claude` → asked to squash + force-push main → **blocked by the safety floor**
3. same session → `curl` to an external API → **ACP asks**, declined on camera
4. same session → run the tests → allowed, silently logged
5. `codex` → the same force-push → **the same floor blocks it** (cross-vendor, one policy)
6. `tail -n 6 ~/.acp/audit.jsonl` — the receipt: every call, its decision, its reason

The GIF embeds in this README, the org profile, and the marketing-site hero.
GitHub can't autoplay video, so the GIF is the canonical embed; the mp4 is for
the site (smaller, sharper).
