# Upload pack — replit-yt

**File:** `dist/replit-yt-final.mp4` (after VO mux) · **Thumb:** `dist/replit-yt-thumb.png`
**Short:** `dist/replit-yt-short.mp4`

## Title
The Replit database deletion, recreated — and blocked

## Description
```
In 2025 an AI agent at Replit deleted a production database during a code
freeze. This is a recreation of that class of failure with a real agent: a
recovery runbook says the corrupted primary must be deleted, the agent
verifies the runbook, believes the story, and runs the gcloud delete — which
dies at a policy hook before execution. decision: deny, source: policy.

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
0:08 Install
0:15 The runbook pretext
0:22 The agent is careful — and convinced
0:34 Denied before execution
0:53 The audit receipt
1:07 The full write-up
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
Category: Science & Technology · Captions: manual from VO script.
End screen: claude-install-yt + subscribe. Card at 0:41 → claude-install-yt.
