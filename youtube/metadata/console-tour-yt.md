# Upload pack — console-tour-yt

**File:** `dist/console-tour-yt-master-sub.mp4` · **Thumb:** `dist/console-tour-yt-thumb.png`
**Short:** `dist/console-tour-yt-short.mp4` · **Captions:** `episodes/console-tour-yt.srt`

## Title
What you actually get: every AI agent's calls in one console

## Description
```
The install videos end at one audit file on one machine. This is the other
half: connect a workspace and the same decisions become a shared console.

A real workspace with real traffic — nothing staged, nothing mocked:

· Activity — one row per governed tool call across every agent. Each row
  carries the tool, what it's allowed to do, the risk level and the reason,
  plus identity and latency. Model calls carry their tokens and cost.
· Approvals — where a step-up policy sends blocked actions. Nothing in the
  queue has executed; approving grants a single retry of that exact action.
· Runs — one row per agent execution. Sort by cost and the expensive ones
  surface.
· Cost X-ray — what a run actually cost, split by step.

Start with the one-command local install (no account, decisions on-device):

    curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

Then connect a workspace when you want the shared view:
https://cloud.agenticcontrolplane.com?utm_source=youtube&utm_medium=video&utm_campaign=console-tour-yt

Works with Claude Code, Codex, opencode and more.

Recorded from the live console. The operator's email and API key identity are
masked; nothing else is altered. The approvals queue happens to be empty in
this recording — 31 approved and 1 rejected on the tabs is the honest state of
it, and we'd rather show that than stage a pending card.

Chapters:
0:00 What this is
0:14 Activity: every governed call, every agent
0:27 Approvals: what a step-up policy sends here
0:38 Every agent in the workspace, not one terminal
0:49 Runs, sorted by cost
1:00 Cost X-ray: where the money went
```

## Tags
ai agent monitoring, ai agent audit log, agentic control plane, ai agent governance console, claude code monitoring, ai agent observability, agent approvals, ai agent cost tracking, llm cost monitoring, ai devops

## Pinned comment
```
Local install first (no account, decisions on-device, full audit trail):

curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local

The console shown here is what you get when you connect a workspace:
https://cloud.agenticcontrolplane.com?utm_source=youtube&utm_medium=video&utm_campaign=console-tour-yt-pin
```

## Upload settings
Category: Science & Technology · Captions: upload `episodes/console-tour-yt.srt`
(no audio track, so YouTube cannot auto-caption — this file is the only text
the platform gets). End screen: claude-install-yt + subscribe. Card at 0:39 →
force-push-yt.

**Pre-publish check — do this on real frames at native resolution, not on a
downscaled preview.** Two things nearly shipped from earlier takes of this
episode: a full `apikey:<uuid>` on the Approvals card, and captions describing
a Policies screen the scene never recorded. Confirm the identity column reads
`d***********com` / `api-key ****399d`, and confirm the X-ray session meta line
is masked too — those are the two places identifiers render.

Judgement calls, not defects, that are visible and are yours to make: the Runs
table shows internal repo and worktree names (`gatewaystack-connect`,
`acp-install`, `worktrees/first-dollar-612`), the X-ray meta line ends with
`cwd: /Users/dev/dev`, and the Home band names integrations in failure states.
All of it is the honest cost of "a real workspace with real traffic."

**Not in this video:** the Policies screen. That page opens on the
rule-recommendation queue, whose cards carry free-text rationale about what
this workspace has been doing — including a card describing a verified
policy-bypass path. It's a real feature and worth its own video, on a workspace
whose queue has been read first.
