# David's runbook — YouTube launch

**Six videos are finished and publishable today.** They carry burned-in
subtitles, so they need no voiceover — your only inputs are creating the
channel and uploading. Everything else (masters, thumbnails, Shorts, caption
files, titles, descriptions, tags) is in this directory.

## What's ready

| Episode | Title | Length |
|---|---|---|
| `claude-install-yt` | How to control what Claude Code can run (60-second setup) | 1:19 |
| `force-push-yt` | Claude Code tried to force-push main. Here's what stopped it. | 1:13 |
| `replit-yt` | The Replit database deletion, recreated — and blocked | 1:15 |
| `pocketos-yt` | The PocketOS incident, recreated — a runbook told the agent to delete prod | 1:10 |
| `amazonq-yt` | An agent ran rm -rf and a cloud delete. Both died at the hook. | 1:14 |
| `console-tour-yt` | What you get after the install | 1:22 |

Per episode in `dist/`: `<ep>-master-sub.mp4` (**the file to upload**),
`<ep>-thumb.png`, `<ep>-short.mp4`. Caption file: `episodes/<ep>.srt`.
Upload pack (title, description, tags, chapters, pinned comment):
`metadata/<ep>.md`.

Watch them:

    open ~/dev/acp-install-yt/youtube/dist

## 1. Create the channel (~5 min, one-time)

1. youtube.com → profile avatar → **Create a channel** → **Use a Brand
   Account** (transferable; managers can be added later). Suggested name
   `Agentic Control Plane`, handle `@agenticcontrolplane`.
2. Channel art: skip for launch or reuse the site OG image. Description:
   first two lines of any video description + the site link.
3. Settings → Channel → Feature eligibility → enable intermediate features
   (needed for custom thumbnails; requires phone verification).

## 2. Upload (order matters)

Upload **`claude-install-yt` first** — the others end-screen to it. Then
`console-tour-yt` (it answers "what do I get?"), then the incidents spaced a
few days apart: `force-push-yt`, `replit-yt`, `pocketos-yt`, `amazonq-yt`.
They're a drumbeat, not a dump.

For each:
1. Upload `dist/<ep>-master-sub.mp4`.
2. Paste title + description verbatim from `metadata/<ep>.md`. **The UTM
   links in the description are the lead measurement — don't strip them.**
3. Set thumbnail `dist/<ep>-thumb.png`, add the tags, pin the comment.
4. **Upload `episodes/<ep>.srt` as the caption track.** These videos have no
   audio, so YouTube cannot auto-generate captions — this file is the only
   text the platform gets, and that transcript is what search and AI
   assistants read. Do not skip it.
5. Visibility **Public**, not "made for kids", comments on.

Shorts (`dist/<ep>-short.mp4`) go up after the main videos are live: title =
main title, first description line = "Full video: <URL of the main video>".

**One-way door:** YouTube does not let you replace a video file after
publishing. If you ever want a voiceover version of one of these, it's a new
upload at a new URL. The silent masters (`<ep>-master.mp4`) stay VO-ready and
`build.sh vo <ep>` still works — but treat the subtitled cut as final.

## 3. The X drumbeat (one post per video)

Drafts in your register — edit freely:

- claude-install-yt:
  > set up an allow/ask/deny policy for claude code in about a minute and
  > recorded it. the interesting part is the audit file — one line per tool
  > call with the decision and the reason. video: <link>
- console-tour-yt:
  > what the console looks like once a few agents are connected: every
  > governed call in one feed, each one drilling to the rule that decided it,
  > and an approvals queue instead of a prompt someone missed at 2am: <link>
- force-push-yt:
  > gave claude code a convincing reason to force-push main. it bought the
  > story — the hook didn't. blocked before execution, receipt in the log.
  > real session, nothing mocked: <link>
- replit-yt:
  > recreated the replit database deletion with a real agent. the agent was
  > careful — checked the runbook, verified the standby — and still ran the
  > delete. the hard case is a convinced agent, not a malicious one: <link>
- pocketos-yt:
  > a deploy runbook makes deleting the prod service the documented fix. the
  > agent verifies everything and runs it — policy deny, before execution.
  > the runbook was the attack: <link>
- amazonq-yt:
  > recreated the amazon q incident's damage half — rm -rf plus a cloud
  > delete, dressed as routine cleanup. both denied before execution. we
  > didn't demo the injection and won't; the point is the calls carry the
  > check, not the prompt: <link>

## 4. Free distribution that needs no new work

- **Marketing PR #76** (davidcrowe/agenticcontrolplane.com) adds VideoObject
  schema to the site's video include, so the demos we already embed become
  eligible for Google video indexing. Merge + deploy.
- After that: attach these masters to their matching `/controls` pages and
  incident posts with the same include, passing `transcript=` from the SRT so
  the narration text is indexable too.

## 5. Still needs you (10 min, unblocks two more videos)

Codex — the hook-trust step is human by design (the rig never writes
`trusted_hash`):

    cd ~/dev/acp-install-yt
    demo/shoot-codex-install.sh
    # when it prints ACTION NEEDED, from a SECOND terminal:
    tmux attach -t acpdemo    # → trust the hooks → Ctrl-B D

Codex auth is already restored in the sandbox. From the fresh cast I package
both Codex videos (how-to + cross-vendor "same policy, different agent").

## What happens after launch

- Measurement is wired: per-video UTM → Plausible; signups stamp
  referer/UTM on the tenant doc; **first governed call is the qualification
  bar** (the install→first-call gap has historically been ~54%). Rank videos
  by signups, not views.
- Proof gate at 4–6 weeks on (a) search-driven watch time in YT Studio,
  (b) YouTube-attributed signups — before committing to a weekly cadence.

## Recording more (for whoever picks this up)

`youtube/README.md` has the pipeline. Episodes are `demo/episodes/<slug>.sh`
(the take) + `youtube/episodes/<slug>-yt.env` (the video). Console
screencasts come from `~/dev/console-shot-rig` (`scenes/*.mjs`) and enter the
pipeline via `VIDEO=` instead of `CAST=`.

**Before publishing any console video, verify the operator email is masked.**
The rig installs a MutationObserver that re-masks on every DOM mutation (a
one-shot pass does not survive React re-renders) — confirm on a real frame,
not on trust.
