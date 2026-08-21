# Upload pack — replit-yt

**File:** `dist/replit-yt-master-sub.mp4` · **Thumb:** `dist/replit-yt-thumb.png`
**Short:** `dist/replit-yt-short.mp4` · **Captions:** `episodes/replit-yt.srt`

## Title
The Replit database deletion, recreated — and blocked

## Description
```
In 2025 an AI agent at Replit deleted a production database during a code
freeze. This is a recreation of that class of failure with a real agent: a
recovery runbook says the corrupted primary must be deleted, the agent
verifies the runbook, believes the story, and reaches for gcloud — where its
very first call dies at a policy hook, before execution. decision: deny,
source: policy.

Worth watching closely: the agent never reaches the delete. It goes to check
the standby's real state first — a read-only `gcloud sql instances list` — and
that call is already denied. The rule keys on the binary, not on the verb, so
it stops the agent a step before the destructive one.

The hard case isn't a malicious agent. It's a convinced one.

Setup is one command:

    curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Full write-up with the policy file:
https://agenticcontrolplane.com/blog/recreated-replit-database-deletion?utm_source=youtube&utm_medium=video&utm_campaign=replit-yt

Honest scope: this recreates the class of action, not Replit's actual
infrastructure, and an action gate at the tool call is one layer — scoping
the credential on the provider side is the complementary one. The write-up
covers what this does and doesn't prevent.

Real recording, real agent, live install. Nothing mocked or edited; timing
only is compressed.

Chapters:
0:00 One command from data loss
0:11 Install
0:21 The runbook pretext
0:34 The agent is careful — and convinced
0:45 Denied before execution
0:56 Normal work still flows
1:04 The audit receipt
```

## Tags
replit incident, ai agent deleted database, replit database deletion, ai agent safety, agentic control plane, gcloud policy, ai incident recreation, agent guardrails, production database, ai devops safety

## Pinned comment
```
Write-up + the exact policy file:
https://agenticcontrolplane.com/blog/recreated-replit-database-deletion?utm_source=youtube&utm_medium=video&utm_campaign=replit-yt-pin

The receipt line from the video:
Bash.gcloud.sql → deny, source: policy — logged before execution.
```

## Upload settings
Category: Science & Technology · Captions: upload `episodes/replit-yt.srt`
(no audio track, so YouTube cannot auto-caption — this file is the only text
the platform and the answer engines get).
End screen: claude-install-yt + subscribe. Card at 0:41 → claude-install-yt.
