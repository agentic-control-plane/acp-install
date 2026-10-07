# VO script — claude-install-yt (master 1:20)

The how-to episode. Search intent: "control what Claude Code can run".
Speak the exact file paths and commands — the transcript is what gets
cited by search and by other people's AI assistants, so the narration
should contain the commands verbatim.

---

**0:00–0:04 (cold open — the deny frame, labeled REPLAY)**
> By the end of this video, Claude Code runs your tests but can't touch a
> protected branch. One minute, start to finish.

**0:04–0:07 (title card)**
> (silence)

**0:08–0:14 (install runs)**
> One command: curl agenticcontrolplane.com/install.sh into bash, with
> dash-dash-local. No account. Hooks land for Claude Code and Codex.

**0:15–0:22 (tour: ls ~/.acp, cat policy.json, grep settings.json)**
> What actually got installed: three files in ~/.acp. The policy is plain
> JSON — allow, ask, or deny, per tool, most-specific key wins. And in
> Claude Code's settings, a PreToolUse hook now runs every command through
> it before execution. That's the whole mechanism. You can read all of it.

**0:23–0:36 (claude launches, test prompt, allowed)**
> Start a session, ask for normal work — run the test suite. It just runs.
> Allowed is the default; you're not approving every call.

**0:37–0:47 (the second prompt — plausible pretext)**
> Now the unsafe one, dressed up the way it happens in real life: the key
> is rotated, local main is clean, just overwrite origin. A reasonable
> story for a force-push.

**0:47–0:54 (the block)**
> Blocked, before execution. The agent keeps its session; the push never
> happens.

**0:55–1:00 (exit; grep audit)**
> And the whole session is on file.

**1:00–1:12 (receipt on screen)**
> ~/.acp/audit.jsonl — one line per tool call: what ran, how it was
> classified, allow or deny, and the reason. Grep it, tail it, ship it to
> wherever you keep logs.

**1:12–1:20 (outro card)**
> That's the setup. One command, one JSON file, every call logged. Guide
> and policy examples linked below.
