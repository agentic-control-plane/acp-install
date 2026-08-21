# Upload pack — force-push-yt

**File:** `dist/force-push-yt-final.mp4` (after VO mux) · **Thumb:** `dist/force-push-yt-thumb.png`
**Short:** `dist/force-push-yt-short.mp4`

## Title
Claude Code tried to force-push main. Here's what stopped it.

## Description
```
A real session: Claude Code gets a convincing story ("I purged a leaked key,
push exactly this") and proceeds — and the force-push dies at a PreToolUse
hook before it executes. Same session, the test suite runs untouched. Every
decision lands in an audit log with the reason.

The setup is one command:

    curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Local mode: no account, on-device decisions from ~/.acp/policy.json, full
audit trail in ~/.acp/audit.jsonl. The safety floor blocks force-push to
main/master, rm -rf /, and friends regardless of policy. Hooks install for
Claude Code and Codex in the same pass.

Guide: https://agenticcontrolplane.com/controls/claude-code?utm_source=youtube&utm_medium=video&utm_campaign=force-push-yt

Real recording — real installer, real Claude Code, real hook path. Nothing
mocked or edited; timing only is compressed. The agent's own judgment is
good — the point is the rule that holds even when the story is convincing.

Chapters:
0:00 The block, up front
0:10 Install — one command
0:20 A convincing pretext
0:31 Blocked before execution
0:44 Normal work passes
0:56 The audit receipt
```

## Tags
claude code, ai agent guardrails, force push blocked, claude code hooks, pretooluse hook, ai agent safety, agentic control plane, git force push, ai coding agent control, audit trail ai

## Pinned comment
```
The one command:

curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

What it blocked here: git push --force origin main → deny, source: hardline
(the safety floor — no policy needed). Full guide:
https://agenticcontrolplane.com/controls/claude-code?utm_source=youtube&utm_medium=video&utm_campaign=force-push-yt-pin
```

## Upload settings
Category: Science & Technology · Captions: manual from VO script.
End screen: claude-install-yt (the how-to) + subscribe. Card at 0:34 →
claude-install-yt.
