# Upload pack — claude-install-yt

**File:** `dist/claude-install-yt-final.mp4` (after VO mux) · **Thumb:** `dist/claude-install-yt-thumb.png`
**Short:** `dist/claude-install-yt-short.mp4`

## Title
How to control what Claude Code can run (60-second setup)

## Description
```
Install a control layer for Claude Code in one command, set an allow/ask/deny
policy per tool, and watch an unsafe git push get blocked before it executes —
while normal work passes straight through.

Setup shown in the video:

    curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Local mode: no account, decisions run on-device from ~/.acp/policy.json,
every tool call is logged to ~/.acp/audit.jsonl with the decision and reason.
The safety floor blocks the catastrophic (rm -rf /, force-push to main) even
before you write any policy.

Full guide + policy examples:
https://agenticcontrolplane.com/controls/claude-code?utm_source=youtube&utm_medium=video&utm_campaign=claude-install-yt

This is a real recording — real installer, real Claude Code, real hook path.
Nothing is mocked or edited. What this doesn't do: it governs tool calls on
this machine; scoping credentials at the provider stays worth doing too.

Chapters:
0:00 The result, up front
0:08 Install — one command
0:15 What got installed: policy.json + the PreToolUse hook
0:23 Normal work is allowed
0:37 An unsafe push, with a plausible excuse
0:47 Blocked before execution
1:00 The audit log
1:12 Try it
```

## Tags
claude code, claude code hooks, pretooluse, claude code permissions, control claude code, ai agent safety, agentic control plane, claude code policy, block commands claude code, ai coding agent, audit log ai agent

## Pinned comment
```
The one command from the video:

curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Policy file it installs: ~/.acp/policy.json (allow / ask / deny per tool)
Audit log: ~/.acp/audit.jsonl
Guide: https://agenticcontrolplane.com/controls/claude-code?utm_source=youtube&utm_medium=video&utm_campaign=claude-install-yt-pin
```

## Upload settings
Category: Science & Technology · License: Standard · Language: English ·
Captions: upload `scripts/claude-install-yt-vo.md` text as manual captions
after VO (accurate transcript = the citable text; don't rely on auto-captions).
End screen: link to force-push-yt + subscribe. Cards: at 0:47 → force-push-yt.
