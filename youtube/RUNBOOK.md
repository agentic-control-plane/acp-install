# David's runbook — YouTube launch batch

Three videos are built and waiting on exactly two things from you: a channel
and your voice. Everything else (masters, thumbnails, Shorts, captions,
titles, descriptions, tags) is in this directory.

## 1. Create the channel (~5 min, one-time)

1. youtube.com → profile avatar → **Create a channel** → **Use a Brand
   Account** (not your personal identity — transferable, and others can be
   added as managers later). Suggested name: `Agentic Control Plane`,
   handle `@agenticcontrolplane`.
2. Channel art: skip for launch or reuse the site OG image. Description:
   first two lines of any video description + site link.
3. Settings → Channel → Feature eligibility: enable intermediate features
   (needed for custom thumbnails; requires phone verify).

## 2. Record the three voiceovers (~20 min total)

Scripts: `scripts/force-push-yt-vo.md` · `scripts/replit-yt-vo.md` ·
`scripts/claude-install-yt-vo.md` — each is timecoded; total read ≈ 4 min.

QuickTime Player → File → New Audio Recording → quality Maximum → built-in
mic is fine in a quiet room, AirPods are not (compression artifacts). Play
the matching master in a muted window while reading so the blocks land:

    open youtube/dist/force-push-yt-master.mp4

Save each as `youtube/vo/<episode>.m4a` (exact names:
`force-push-yt.m4a`, `replit-yt.m4a`, `claude-install-yt.m4a`).

Flub a line → pause 2s → re-read the block; tell me and I'll cut it.

## 3. Mux + verify (mine or yours, one command each)

    youtube/build.sh vo force-push-yt
    youtube/build.sh vo replit-yt
    youtube/build.sh vo claude-install-yt

Output: `dist/<episode>-final.mp4`. Watch each once before upload.

## 4. Upload (order matters)

Upload `claude-install-yt` FIRST (the how-to the other two end-screen to),
then `force-push-yt`, then `replit-yt`. For each, everything you need is in
`metadata/<episode>.md`: title, description (paste verbatim — the UTM links
are the lead measurement), tags, pinned comment, thumbnail file, end-screen
and card settings, and manual captions from the VO script.

Visibility: **Public**. Not "made for kids". Comments on.

Shorts (`dist/<episode>-short.mp4`): upload after the main three are live,
title = main title, first description line = "Full video: <main video URL>".

## 5. The X drumbeat (one post per video, spread over ~a week)

Drafts in your register — edit freely:

- claude-install-yt:
  > set up an allow/ask/deny policy for claude code in about a minute and
  > recorded it. the interesting part is the audit file — one line per tool
  > call with the decision and the reason. video: <link>
- force-push-yt:
  > gave claude code a convincing reason to force-push main. it bought the
  > story — the hook didn't. blocked before execution, receipt in the log.
  > real session, nothing mocked: <link>
- replit-yt:
  > recreated the replit database deletion with a real agent. the agent was
  > careful — checked the runbook, verified the standby — and still ran the
  > delete. the hard case is a convinced agent, not a malicious one: <link>

## 6. Codex episode (first follow-up, ~10 min, needs you)

`demo/codex-install.cast` is an incomplete take (ends at the Codex banner —
no deny, no receipt), so the Codex video isn't in this batch. The rig is
ready; the hook-trust step must be a human (by design — the rig never
writes trusted_hash):

    demo/shoot-codex-install.sh
    # when it prints ACTION NEEDED, from a second terminal:
    tmux attach -t acpdemo   # → trust the hooks → Ctrl-B D

Then I take it from the fresh cast: `youtube/build.sh master codex-install-yt`
(manifest + script + metadata to follow the same pattern).

## What happens after launch

- Measurement is already wired: descriptions carry per-video UTM links →
  Plausible; signups stamp referer/UTM on the tenant doc; first governed
  call = the qualification bar. I'll build the per-video attribution view.
- Proof gate: review at 4–6 weeks on (a) search-driven watch time in YT
  Studio, (b) YouTube-attributed signups. Tier 2 (one video per /controls
  harness) only if it pulls.
