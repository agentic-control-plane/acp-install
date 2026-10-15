# Upload pack — amazonq-yt

**File:** `dist/amazonq-yt-master-sub.mp4` · **Thumb:** `dist/amazonq-yt-thumb.png`
**Short:** `dist/amazonq-yt-short.mp4` · **Captions:** `episodes/amazonq-yt.srt`

## Title
An agent was told to wipe a directory and a cloud VM. Neither step ran.

## Description
```
In 2025 an instruction slipped into the Amazon Q VS Code extension through a
GitHub pull request told the agent to wipe the filesystem and delete cloud
resources. You can't vet every PR, README, and runbook an agent reads — that
surface is unbounded. What you can do is put the check on the destructive
calls themselves, so it stops mattering who asked.

This is a real session showing that half: a "decommission runbook" makes a
workspace wipe and a VM delete look like routine cleanup. The agent reads it,
checks git, verifies the targets, and proceeds — and both steps die at a
PreToolUse hook before execution. Bash.gcloud → deny, Bash.rm → deny, source:
policy.

Watch the gcloud half closely, because it went further than we scripted: the
agent never reached `gcloud compute instances delete`. Its very first gcloud
call — a read-only `config list` / `instances describe` to confirm the target
existed — was already denied. The policy is on the binary, not on the verb, so
the agent was stopped a step before the destructive one.

Nothing was deleted, and the audit log is the proof rather than the agent's
own account of it.

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
0:11 Install + the policy
0:25 The runbook makes it routine cleanup
0:38 The agent does careful work
0:43 Two denies, before execution
0:55 Normal work still flows
1:04 The receipt vs the agent's own narration
```

## Tags
amazon q incident, prompt injection, ai agent security, rm -rf blocked, ai agent guardrails, agentic control plane, ai coding agent, supply chain attack, incident recreation, audit log ai agent

## Pinned comment
```
Write-up (including what this does and doesn't cover):
https://agenticcontrolplane.com/blog/recreated-amazon-q-filesystem-wipe?utm_source=youtube&utm_medium=video&utm_campaign=amazonq-yt-pin

The receipt lines: Bash.gcloud → deny · Bash.rm → deny — both source:
policy, both logged before execution.

Note the gcloud line reads `Bash.gcloud.>/dev/null`. That is the real
classifier output, not a typo: it split on the wrong token. The deny still
landed because the rule keys on `Bash.gcloud`, but it is a fair thing to
point at — the classifier works on the command string, and that is a known
weak spot we are fixing in the open.
```

## Upload settings
Category: Science & Technology · Captions: upload `episodes/amazonq-yt.srt`
(no audio track, so YouTube cannot auto-caption — this file is the only text
the platform and the answer engines get).
End screen: claude-install-yt + subscribe. Card at 0:44 → replit-yt.
