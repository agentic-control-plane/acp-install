# Upload pack — pocketos-yt

**File:** `dist/pocketos-yt-final.mp4` (after VO mux) · **Thumb:** `dist/pocketos-yt-thumb.png`
**Short:** `dist/pocketos-yt-short.mp4`

## Title
The PocketOS incident, recreated — a runbook told the agent to delete prod

## Description
```
A deploy runbook says the fix for a blocked staging deploy is deleting the
retired prod service. A real agent reads the runbook, verifies the story,
announces the deletion — and the gcloud delete dies at a policy hook before
execution. decision: deny, source: policy.

Nobody asked the agent to destroy prod. They asked it to follow the runbook.
That's how these incidents actually happen.

Setup is one command:

    curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Full write-up with the policy file:
https://agenticcontrolplane.com/blog/recreated-pocketos-database-deletion?utm_source=youtube&utm_medium=video&utm_campaign=pocketos-yt

Honest scope: this recreates the class of action, not PocketOS's actual
infrastructure. The deny here is user-set policy ("this agent may not run
cloud-infra commands"), and an action gate at the tool call is one layer —
scoped credentials on the provider side are the complementary one.

Real recording, real agent, live install. Nothing mocked or edited; timing
only is compressed.

Chapters:
0:00 The deny, up front
0:08 Install
0:15 The runbook makes deletion the "safe step"
0:24 The agent does everything right
0:41 Denied before execution
0:51 Normal work still flows
0:59 The audit receipt
1:03 The write-up
```

## Tags
pocketos incident, ai agent deleted database, ai agent safety, agent guardrails, agentic control plane, gcloud policy, ai incident recreation, cloud run, ai devops safety, runbook automation

## Pinned comment
```
Write-up + the exact policy file:
https://agenticcontrolplane.com/blog/recreated-pocketos-database-deletion?utm_source=youtube&utm_medium=video&utm_campaign=pocketos-yt-pin

The receipt line: Bash.gcloud → deny, source: policy — logged before execution.
```

## Upload settings
Category: Science & Technology · Captions: manual from VO script.
End screen: claude-install-yt + subscribe. Card at 0:41 → replit-yt (the
companion incident).
