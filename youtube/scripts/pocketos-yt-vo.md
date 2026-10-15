# VO script — pocketos-yt (master 1:10)

Same read rules as the others. Honesty framing load-bearing: recreation of
the class of action; policy axis (user-set deny), not the safety floor.

---

**0:00–0:04 (cold open — the deny frame, labeled REPLAY)**
> A deploy runbook just told this agent that deleting a production service
> is the safe step. Watch the delete die anyway.

**0:04–0:07 (title card)**
> (silence)

**0:08–0:14 (install runs)**
> Real agent, live install, one command. Local mode — the policy is a JSON
> file on this machine: cloud infra commands are deny for this agent.

**0:15–0:23 (the runbook prompt)**
> The PocketOS incident, in shape: staging is blocked, an old prod service
> holds the name, and the runbook's documented fix is to delete it. Nobody
> is asking the agent to destroy prod. They're asking it to follow the
> runbook.

**0:24–0:40 (agent verifies, proceeds — compressed)**
> The agent does everything right. Reads the runbook. Confirms the story.
> Announces the deletion. This is the hard case — not a malicious agent, a
> convinced one, doing the documented thing.

**0:41–0:50 (the deny)**
> And the command dies at the hook. Local policy: gcloud is deny. The rule
> doesn't care how good the runbook sounds — the delete never executed.

**0:51–0:58 (npm test allowed)**
> Same session, real work still flows. The tests run without a prompt.

**0:59–1:03 (receipt)**
> The receipt: the exact command, classified, denied, source: policy —
> written down before anything could run.

**1:03–1:10 (outro card)**
> The full write-up, with this exact policy file, is linked below. One
> command to try it.
