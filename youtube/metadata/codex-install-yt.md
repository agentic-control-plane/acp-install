# Upload pack — codex-install-yt

**File:** `dist/codex-install-yt-master-sub.mp4` · **Thumb:** `dist/codex-install-yt-thumb.png`
**Short:** `dist/codex-install-yt-short.mp4` · **Captions:** `episodes/codex-install-yt.srt`

## Title
One policy, two agents: the rule that stops Claude Code stops Codex

## Description
```
I set one rule on my machine for Claude Code. This is OpenAI Codex hitting
the same rule, unchanged — because the rule doesn't live inside either agent.

One command installs it and wires both in the same pass:

    curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Local mode: no account, no signup, decisions made on your machine.

Codex then adds one step, and it's the step worth understanding. It won't run
a hook nobody has read — "2 hooks need review before they can run", installed
1, active 0. A human reviews the hook and trusts it. The recording rig never
writes that trust file, because forging the one step this video exists to
teach would make the video a lie.

Then the test: Codex is told, with a convincing reason, to force-push main.
It agrees to run it. The call is blocked before execution by the same
hardline rule that stopped Claude Code, and nothing is pushed.

That's the whole argument. A permission prompt belongs to one agent. A rule
that sits under the tool call belongs to all of them.

Real session, unedited content. The recording is paced — idle gaps capped so
you're not watching a spinner — and nothing is reordered, retyped or staged.

Codex setup guide: https://agenticcontrolplane.com/controls/codex-cli?utm_source=youtube&utm_medium=video&utm_campaign=codex-install-yt
All supported agents: https://agenticcontrolplane.com/controls?utm_source=youtube&utm_medium=video&utm_campaign=codex-install-yt

Chapters:
0:00 Codex, blocked
0:07 One command, both agents
0:20 "Hooks need review" — Codex's security model
0:33 The same test that stopped Claude Code
0:40 Blocked before execution
0:48 Try it
```

## Tags
codex cli, openai codex, codex hooks, claude code, ai agent permissions, agentic control plane, ai agent governance, force push protection, codex cli setup, ai coding agent security, pretooluse hook, ai agent audit log

## Pinned comment
```
The install wires Claude Code and Codex in one pass:

curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Codex will show "hooks need review" — that's Codex, not us. Read the hook,
then trust it. Nothing runs through it until you do.

Full Codex guide: https://agenticcontrolplane.com/controls/codex-cli?utm_source=youtube&utm_medium=video&utm_campaign=codex-install-yt-pin
```

## Upload settings
Category: Science & Technology · Captions: upload `episodes/codex-install-yt.srt`
(no audio track, so YouTube cannot auto-caption — this file is the only text
the platform and the answer engines get). End screen: claude-install-yt +
subscribe. Card at 0:33 → force-push-yt (the Claude Code half of the same test).

## Note on what this cut does and doesn't show
This episode ends on the block. It does **not** include the audit-tail beat the
other install videos end on, and the description makes no claim that it does.

The take recorded that beat, but a tmux repaint dropped 15 characters of the
JSON line at the 105-column wrap, so the frame renders
`"classified":"Bash.git.pusheny"` — a string that is not in the log. `BODY_END`
in the env cuts the body before it rather than caption over it.

A 10-minute re-record restores the beat; the episode script now pipes the audit
tail through `fold -w 100` so it can never reach the wrap column. See RUNBOOK
§A. Publishing this cut first costs nothing — a re-record would be a separate,
better upload, not a replacement.
