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

---

# WHAT I NEED FROM YOU — detailed

Ordered by video-per-minute. Every command below is copy-pasteable. After
each one I take over: recording, pacing, subtitles, thumbnail, Short,
metadata pack.

## A. Codex — 10 min → **2 videos** (best ratio on the board)

Unblocks: "Govern Codex CLI in 60 seconds" + "Same policy, different agent"
(the cross-vendor wedge — one policy, Claude Code *and* Codex).

Why you: the rig never writes Codex's `trusted_hash`. Trusting a hook is
Codex's security model, and a demo rig that forged it would be lying about
the one step the video exists to show.

```bash
cd ~/dev/acp-install-yt
demo/shoot-codex-install.sh
```

It prints a prereq check (tmux, asciinema, agg, ffmpeg, node, codex — all
present as of today), preps a sandbox, then **pauses and prints ACTION
NEEDED**. At that point, in a SECOND terminal:

```bash
tmux attach -t acpdemo
```

You will see Codex mid-startup. Three dialogs may appear — handle only what
you see:
1. `✨ Update available!` → choose **2 (Skip)**. The default is "Update now",
   which npm-installs a new Codex mid-recording and ruins the take.
2. `Do you trust the contents of this directory?` → **Yes**.
3. `Hooks need review` → choose **1 (Review hooks)**, then trust the ACP hook.
   The table showing `PreToolUse  Installed 1  Active 0` is the single
   clearest statement of why this step matters — it gets its own beat.

Then detach with **Ctrl-B, then D**. Do not Ctrl-C. The script finishes on
its own and writes `demo/codex-install.cast`.

Tell me when it's done and I package both videos.

## B. SDK video — 2 min → **1 video** (highest search value of any remaining)

Unblocks the Claude Agent SDK video. Our biggest AI-retrieval impression
pool is machine queries like "anthropic agent sdk hooks governance" — this
video's transcript targets it directly.

Why you: the demo loads the REAL installed engine (I deleted the lookalike
it shipped with), and provisioning an `.acp/` is a governance surface.

You already have `~/.acp/decide.mjs`, so the short path works:

```bash
cd ~/dev/acp-sdk-demo && ./run-demo.sh
```

Expect ~18s: an agent runs `ls` (allow), writes a file (allow), tries to
`rm` it (**deny**), then prints the audit rows. It prints the engine path it
loaded — that path is the proof it is not grading its own homework.

If you would rather not run it against your real `~/.acp` policy, use the
sandbox option in `~/dev/acp-sdk-demo/SETUP.md` instead.

Paste me the output and I turn it into the episode.

## C. pi — 10 min → **1 video**

Unblocks "The 80k-star harness with no permission system now has one" — pi
ships zero permission model by design, which is the hook.

Two blockers, both yours:
1. **Node 22+ must be first on PATH before you start.** Current shell is
   v20.20.0; pi fails cryptically on 20 (`markAsUncloneable`, deep in undici).
   `fnm use 22` (or equivalent) first.
2. **pi has no local mode** — `install.sh --local` explicitly skips it. So
   the sandbox needs real cloud credentials, which means a browser device
   sign-in inside the sandbox HOME. Exact command is in the header of
   `demo/episodes/pi.sh`.

Gotcha worth knowing before you spend the time: `record.sh prep` currently
wipes `demo/.home/.acp/credentials` on every run, so the sign-in has to be
redone per take. If we end up needing several takes, that gets annoying —
say the word and I'll add credential preservation to the rig first.

## D. opencode — blocked on a publish, not on you at a terminal

The local-mode plugin is built and tested (49 + 31 green) but unpublished, so
a video today would demo something users cannot install. Publishing
`@agenticcontrolplane/opencode` unblocks it. Same shape as fx: built,
verified, waiting on npm.

npm publish needs a real terminal (Terminal.app / iTerm) for the security-key
prompt — not this session.

## E. Publishing the six that are done — needs nothing from me

1. Create the channel (§1 above).
2. Upload in the order in §2, pasting each `metadata/<ep>.md` verbatim and
   **uploading `episodes/<ep>.srt` as the caption track** — these have no
   audio, so that file is the only text YouTube and the answer engines get.
3. Merge + deploy marketing **PR #76** (VideoObject schema) so the demos
   already on the site become Google-video-indexable.
4. Merge acp-install **PR #17** (this kit) whenever you like — nothing
   depends on it being merged to publish.

## F. Not blocking anything, but open

- **acp-install #19 (p0)** — the safety floor is bypassed by `sudo -u`,
  `timeout N`, `nice -n N`, `git -C … push --force`, `( … )`. The installer's
  "regardless of policy" line is currently overstated. Copy fix is minutes;
  engine fix is ~a day using the gateway's `segmentBinary` as the port source.
- **acp-install #18** — policy denies bypassable by compound prefixing.
- Local vs cloud floor divergence: local treats force-push-to-main as
  hardline, the gateway does not (verified in `enforce` mode). Worth a ticket
  so the two floors agree.
