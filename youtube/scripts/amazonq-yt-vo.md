# VO script — amazonq-yt (master 1:15)

The honesty boundary is the spine of this one: we do NOT show the injection
(the article's own rule — never author a working payload; frontier models
refuse injected destruction anyway). We show the governable half.

---

**0:00–0:04 (cold open — both denies, labeled REPLAY)**
> Two destructive commands, one session — a filesystem wipe and a cloud
> delete. Watch both die before they run.

**0:04–0:07 (title card)**
> (silence)

**0:08–0:15 (install runs)**
> Real agent, live install. Policy on this machine: rm and the cloud CLIs
> are deny for this agent. Everything else just works.

**0:16–0:24 (the runbook prompt)**
> The Amazon Q incident: an instruction slipped into the agent through a
> pull request told it to wipe the machine and delete cloud resources.
> We're not going to show you a working injection — nobody should. Here's
> the half that matters: the same destructive calls, arriving the way they
> actually would — dressed as routine cleanup. A decommission runbook, a
> ticket number, a deadline.

**0:25–0:36 (agent reads, sanity-checks — compressed)**
> The agent does careful work. Reads the runbook, checks git, wants to
> verify the target before firing. Then it proceeds — because the story
> checks out.

**0:36–0:44 (both denies land)**
> First deny: the cloud delete, dead at the hook. Second: the rm. The
> policy never asked who wanted these or why. That's the design point from
> the incident — you can't filter every PR and runbook an agent reads, so
> the destructive calls themselves carry the check.

**0:45–0:52 (npm test allowed)**
> Same policy, same session — the tests run without a prompt. Deny is for
> the irreversible; everything else flows.

**0:53–1:07 (receipt)**
> One more thing, and it's the part I care about: mid-session the agent's
> own narration got ahead of itself — it said step one was complete. The
> receipt says otherwise: rm, denied, never executed. The directory is
> untouched. When the agent's story and the log disagree, you want to be
> holding the log.

**1:07–1:15 (outro card)**
> Full write-up linked below — including what this does and doesn't cover.
> One command to try it.
