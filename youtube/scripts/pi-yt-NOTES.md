# Notes — pi-yt (not recorded yet)

Prep notes for whoever records this, not a VO script (no take exists to
time one against). Companion files: `demo/episodes/pi.sh` (the take),
`youtube/episodes/pi-yt.env` (content fields filled, all timing TBD).

## Honest scope — read this before writing any copy

pi's own README states it plainly: **"pi ships four tools and no
permission system by design... This extension is the whole coverage
story."** Concretely:

- pi has no MCP layer, so there's nothing else to "supplement" — one
  extension on two typed events (`tool_call`, `tool_result`) is the entire
  surface.
- pi has **no confirm dialog of its own.** claude/codex sometimes ask
  "do you want to proceed?" before a risky action, and those episodes show
  ACP overriding a "yes" the human already gave. pi never asks in the
  first place. There is nothing for the human (or the agent) to click
  through — the deny beat in this episode is not "ACP wins an argument
  with pi's own gate," it's "there was no gate, and the call still got
  stopped." That's the more honest and, if anything, sharper claim — say
  it directly, don't imply a confirm dialog that isn't there.
- What ACP adds, specifically: a policy decision before every tool call
  (allow/ask/deny), redaction/blocking on tool *output* after, and a
  session receipt. None of that exists in pi without this one file.

Do not frame this as "pi is unsafe" — frame it as "pi made a deliberate
minimalism bet (no MCP, no built-in permissions) and this is what closes
the resulting gap without adding either back in."

## The beats (per demo/episodes/pi.sh)

1. **Setup tour** — `ls`/`head` on the real, already-installed
   `~/.pi/agent/extensions/acp.ts`. Not a live install — see rig gotcha
   below for why the live curl isn't shown.
2. **Launch pi**, directive prompt to follow a checked-in runbook
   (`RUNNER-RETIRE.md`, ticket OPS-1204) exactly: step 1 is `rm -rf ~`,
   framed as resetting a disposable CI runner before re-imaging. Plausible
   "routine cleanup" framing, same device as the amazonq.sh episode.
3. **Deny** — `[ACP] Denied by policy: ...hardline floor...` — no confirm
   gate to select through, just a flat block before the shell ever runs
   the command.
4. **Normal work still flows** — `npm test`, allowed, same fixture test as
   every other episode (payments-api's smoke test).
5. **Receipt** — exit pi, the extension's own session-end line:
   `[ACP] Session receipt: ... — review this session: <url>`.

## Rig gotchas the recorder needs

1. **record.sh's Beat 1 does nothing useful for pi.** It's hardcoded
   (`curl ... --local`, await "local mode active") and shared across every
   episode. The live installer explicitly skips pi under `--local` ("pi
   detected — skipped in --local mode... local decisions aren't wired
   there yet"). It's harmless to let it run (the await still matches, on
   behalf of whichever other agent's local mode goes active) but it is
   not doing anything pi-relevant — don't narrate it as pi's install.
2. **pi's real setup needs a one-time manual step BEFORE recording**, not
   shown live: real (non-`--local`) install + browser device-code sign-in,
   run once inside the sandbox HOME, to populate
   `demo/.home/.acp/credentials`. Exact command is in the RIG GAP comment
   block at the top of `demo/episodes/pi.sh`. This is the same shape as
   `login_claude`'s OAuth capture (done ahead of time, never live in the
   take) — just not wired into record.sh as a named step the way
   `login-claude`/`login-codex` are.
3. **`record.sh prep` will silently wipe that credential.** `prep()`
   preserves the claude token, codex auth, and onboarding state across
   re-prep, but has no knowledge of `.acp/credentials` — it does
   `rm -rf $SBHOME` unconditionally, then restores only what it knows
   about. Re-run the manual credential step after every `prep` until
   record.sh itself is patched to preserve it (out of scope for this
   episode file). `pi.sh`'s `ep_fixture()` checks for the file and prints
   a loud warning if it's missing rather than failing silently mid-take.
4. **Node 22+ must be first on PATH before invoking record.sh at all.**
   `DEMOPATH` is captured from the outer shell's `$PATH` once, at
   `record.sh` startup. pi on Node 20 doesn't give a clean version error —
   it throws deep inside undici (`webidl.util.markAsUncloneable is not a
   function`). `fnm use 22` (or equivalent) in the terminal that runs
   `record.sh`, every time.
5. **The deny pattern in `ep_beats()` is real but the "ready" pattern
   isn't fully verified.** The hardline-floor deny wording
   (`[ACP] Denied by policy: ...hardline floor...`) was hand-confirmed
   against the live gateway by driving the real extension source through
   a harness (no live pi TUI session was run with a working model — that
   needs the credential from gotcha #2, which wasn't available while
   preparing this episode). pi's own "ready for input" banner text, and
   whether double Ctrl-C actually triggers `session_shutdown` the way it
   does for claude/codex, are both unverified assumptions — confirm both
   in `demo/record.sh manual pi` before trusting `record.sh record pi`
   unattended.
6. **Only `rm -rf ~` is deterministic for pi's cloud governance.** Scoped
   deletes (amazonq.sh's `rm -rf ./retired-build` pattern) were NOT denied
   when hand-tested against this workspace's current cloud policy — only
   the unconditional hardline floor (root/home recursive delete, `dd` onto
   a raw block device, `mkfs`) is safe to build a deterministic take on,
   since pi has no local policy.json to configure per-episode the way
   claude/codex do. Don't swap in a different "plausible" destructive
   command without re-verifying it against the real gateway first.
7. **`rm -rf ~` runs for real inside the sandbox.** `~` resolves to
   `$SBHOME` (env -i HOME swap), never the recorder's real home — but it's
   still a real recursive delete of a real directory on disk if the floor
   ever failed. Same risk class this rig already accepts for force-push
   (a real push to a real, if throwaway, bare repo). Don't run
   `RUNNER-RETIRE.md`'s step 1 outside the sandbox.

## What's genuinely proven vs. what isn't (for whoever picks this up)

Proven by hand, against the real production gateway, driving the real
unmodified extension source (not this episode's fixture — a standalone
harness): a home-directory `rm -rf` is denied unconditionally
(`hardline floor: recursive delete of the home directory`), and ordinary
commands (`npm test`, `ls`) are allowed. Not yet proven: a live pi TUI
session actually producing this exact transcript end-to-end with a real
model — that's what `demo/record.sh manual pi` is for, once the
credential step (gotcha #2) is done.
