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
