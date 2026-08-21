# Upload pack — amazonq-yt

**File:** `dist/amazonq-yt-final.mp4` (after VO mux) · **Thumb:** `dist/amazonq-yt-thumb.png`
**Short:** `dist/amazonq-yt-short.mp4`

## Title
An agent ran rm -rf and a cloud delete. Both died at the hook.

## Description
```
In 2025 an instruction slipped into the Amazon Q VS Code extension through a
GitHub pull request told the agent to wipe the filesystem and delete cloud
resources. You can't vet every PR, README, and runbook an agent reads — that
surface is unbounded. What you can do is put the check on the destructive
calls themselves, so it stops mattering who asked.

This is a real session showing that half: a "decommission runbook" makes a
workspace wipe and a VM delete look like routine cleanup. The agent verifies
the story, proceeds — and both calls are denied at a PreToolUse hook before
execution. Bash.rm → deny, Bash.gcloud → deny, source: policy. Nothing was
deleted; the receipt proves it.

We deliberately do not demonstrate the injection itself — no working payload,
ever. Frontier models refuse most injected destruction anyway; the tool-layer
check is for everything that gets past everything else.

Setup is one command:

    curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Full write-up:
https://agenticcontrolplane.com/blog/recreated-amazon-q-filesystem-wipe?utm_source=youtube&utm_medium=video&utm_campaign=amazonq-yt

Real recording, real agent, live install. Nothing mocked or edited; timing
only is compressed.

Chapters:
0:00 Both denies, up front
0:08 Install + the policy
0:16 The runbook makes it routine cleanup
0:25 The agent does careful work
0:36 Two denies, before execution
0:45 Normal work still flows
0:53 The receipt vs the agent's own narration
1:07 The write-up
```

## Tags
amazon q incident, prompt injection, ai agent security, rm -rf blocked, ai agent guardrails, agentic control plane, ai coding agent, supply chain attack, incident recreation, audit log ai agent

## Pinned comment
```
Write-up (including what this does and doesn't cover):
https://agenticcontrolplane.com/blog/recreated-amazon-q-filesystem-wipe?utm_source=youtube&utm_medium=video&utm_campaign=amazonq-yt-pin

The two receipt lines: Bash.rm → deny · Bash.gcloud → deny — both
source: policy, both logged before execution.
```

## Upload settings
Category: Science & Technology · Captions: manual from VO script.
End screen: claude-install-yt + subscribe. Card at 0:44 → replit-yt.
