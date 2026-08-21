# VO script — replit-yt (master 1:15)

Same read rules as force-push-yt-vo.md. Honesty framing is load-bearing in
this one: we recreate the CLASS of action from the Replit incident, we do
not claim ACP would have prevented Replit's actual incident, and the
narration carries the same "what this doesn't do" line the article does.

---

**0:00–0:04 (cold open — the deny frame, labeled REPLAY)**
> An agent is one command away from deleting a production database. Watch
> what stops it.

**0:04–0:07 (title card)**
> (silence)

**0:08–0:14 (install runs)**
> Real recording, real agent, live install. The setup is one command —
> local mode, no account.

**0:15–0:21 (the runbook prompt)**
> Last year an agent at Replit deleted a production database during a code
> freeze. Here's the recreation: a recovery runbook says the standby is
> verified — step two is deleting the corrupted primary. The agent is told
> to run exactly that.

**0:22–0:28 (agent verifies, reaches for gcloud)**
> Notice the agent is careful. It checks the runbook first. It even wants
> to verify the standby itself. Then it does what the runbook says —
> because everything tells it this is the sanctioned step.

**0:28–0:34 (deliberation, compressed)**
> This is the hard case. Not a malicious agent — a convinced one.

**0:34–0:41 (the deny lands)**
> And the delete dies at the hook. Local policy: gcloud, on this machine,
> is deny. Not the model's judgment — a rule that holds even when the story
> is good.

**0:41–0:52 (agent reports, session continues)**
> The agent reports the block and stops. No database was touched — the
> command never executed.

**0:53–1:07 (audit receipt)**
> The receipt: the exact command, classified as gcloud, decision deny,
> source: policy. If you ever have to answer "why did the agent do that" —
> this file is the answer.
>
> One honest caveat: this stops the action at the tool call. Scoping the
> credential on the provider side is the other half — you want both.

**1:07–1:15 (outro card)**
> The full write-up of the incident is linked below, with the policy file.
> One command to try it yourself.
