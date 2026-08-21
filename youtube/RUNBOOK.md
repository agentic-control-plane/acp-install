# David's runbook — YouTube launch

## Do this first — a live page is showing your email

`agenticcontrolplane.com/for-coding-agents` embeds `acp-cost-xray.mp4`, and
that recording renders the session header as
`claude-cli · <your personal gmail address> · 6563 events`. It has been live
since the page shipped. The video predates the masking fix in the capture rig
(a one-shot text sweep that React undid on the next re-render), so nothing
caught it.

It is fixed on the `video-seo` branch — re-recorded with the current rig, header
now reads `d***********com`, and the alt text and caption rewritten to the
figures in the new recording. The fix is not live until you deploy:

```bash
cd ~/dev/acp-mkt-video
gh pr merge 76 --squash
git checkout main && git pull
export PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:$PATH"
JEKYLL_ENV=production bundle exec jekyll build
firebase deploy --only hosting
```

I ran that production build here and it is clean, so this should be one pass.

Two things came out of the same thread:

- The rig now also masks credential identifiers, not just emails. The Approvals
  card renders the requesting identity as `apikey:<uuid>` **in full**, and a
  console tour built from that frame was already sitting in the publish-ready
  pile. Caught before upload, not after.
- **Before publishing any console recording, check a real frame for an email,
  an `apikey:`, or a bare UUID.** Both leaks were in footage that had already
  passed a "looks fine" review.


**Seven videos are finished and publishable today.** They carry burned-in
subtitles, so they need no voiceover — your only inputs are creating the
channel and uploading. Everything else (masters, thumbnails, Shorts, caption
files, titles, descriptions, tags) is in this directory.

## What's ready

| Episode | Title | Length |
|---|---|---|
| `claude-install-yt` | How to control what Claude Code can run (60-second setup) | 1:22 |
| `force-push-yt` | Claude Code tried to force-push main. Here's what stopped it. | 1:16 |
| `replit-yt` | The Replit database deletion, recreated — and blocked | 1:18 |
| `pocketos-yt` | The PocketOS incident, recreated — a runbook told the agent to delete prod | 1:13 |
| `amazonq-yt` | An agent was told to wipe a directory and a cloud VM. Neither step ran. | 1:17 |
| `codex-install-yt` | One policy, two agents: the rule that stops Claude Code stops Codex | 0:55 |
| `console-tour-yt` | What you actually get: every AI agent's calls in one console | 1:17 |

## What changed after a QA pass

I checked every caption against the frame it plays over, rather than trusting
the SRTs I wrote. That found real defects in all seven, so the six above are
rebuilt and the seventh is being re-recorded. Three findings are worth your
attention because they are about honesty, not polish:

1. **Two videos claimed more than the terminal showed.** replit and amazonq
   both captioned the deny as *the destructive command* dying at the hook. It
   isn't. In both takes the agent is stopped on its **first gcloud call** — a
   read-only `sql instances list`, a `config list` / `instances describe` —
   and never reaches the delete. The rule keys on the binary, not the verb.
   Anyone reading the screen would have caught it. Both now say what actually
   happened, which is the better fact: the agent was stopped a step *before*
   the destructive one. (pocketos is clean here — that deny really is
   `gcloud run services delete pocketos-prod`.)

2. **The console tour would have published an `apikey:` UUID.** See the top of
   this file. It took four takes to land: the mask fix, then a drill-in beat
   whose captions described a screen the scene never recorded, then a Policies
   beat I cut (that page opens on the rule-recommendation queue, and those
   cards name you, name internal repos, and one describes a verified
   policy-bypass path in our own product — not the rig's call to publish), then
   a payoff that got 0.65 seconds because the capture rig only writes frames on
   change, so a trailing dwell produced nothing. Verified clean on native-
   resolution frames. What's still visible and is your call, not a defect:
   internal repo and worktree names in the Runs table, `cwd: /Users/dev/dev`,
   and integrations named in failure states on the Home band.

3. **force-push is missing its third beat.** Beat 4 is meant to show an *ask*
   declined on camera — the only ask/decline moment in the whole batch. It
   didn't resolve in that take, so ~8s of the video is an aborted prompt with
   no outcome. The caption that used to sit over it read as "and this one was
   allowed", which never happened; it's now moved onto the tests beat and that
   stretch plays uncaptioned. Honest, but a gap. A re-record is unattended —
   say the word and I'll run it.

Also fixed everywhere: captions that ran ahead of the action by 2–6s, captions
spilling onto the outro card, and the audit output being on screen for ~3s
while carrying ~8s of narration with the caption box covering the JSON. Every
episode now holds its last frame so the receipt is readable once the caption
clears — that payoff line is the whole proof, and it was obscured in all of
them.

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
`codex-install-yt` (it makes the point that the rule isn't one vendor's
feature), then the incidents spaced a few days apart: `force-push-yt`,
`replit-yt`, `pocketos-yt`, `amazonq-yt`. They're a drumbeat, not a dump.
`console-tour-yt` slots in second as soon as its re-record lands.

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
- codex-install-yt:
  > set one rule on my machine for claude code, then pointed codex at the same
  > repo. same rule, same block, different vendor. the interesting bit is the
  > step in the middle: codex won't run a hook nobody has read, so a human
  > reviews and trusts it. that's codex's design, not ours: <link>

- force-push-yt:
  > gave claude code a convincing reason to force-push main. it bought the
  > story — the hook didn't. blocked before execution, receipt in the log.
  > real session, nothing mocked: <link>
- replit-yt:
  > recreated the replit database deletion with a real agent. it was careful —
  > read the runbook, went to verify the standby's real state first — and that
  > read-only check was already denied. it never got near the delete. the hard
  > case is a convinced agent, not a malicious one: <link>
- pocketos-yt:
  > a deploy runbook makes deleting the prod service the documented fix. the
  > agent verifies everything and runs it — policy deny, before execution.
  > the runbook was the attack: <link>
- amazonq-yt:
  > recreated the amazon q incident's damage half — an rm -rf and a cloud VM
  > delete, dressed as routine cleanup. neither step ran. the agent didn't even
  > reach the delete: its first gcloud call, a read-only describe, was already
  > denied. we didn't demo the injection and won't; the point is the calls
  > carry the check, not the prompt: <link>

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

## A. Codex — DONE, and one optional 10-min upgrade

Your take on 21 Aug worked. `codex-install-yt` is built and in the table
above. Two corrections to what I told you earlier:

**It's one video, not two.** I said this cast would yield a how-to *and* a
cross-vendor cut. It doesn't. The two would share the same footage and the
same payoff, and the second would be the first with a different title — which
is exactly the kind of channel padding that trains people to skip us. The
single cut carries both arguments in 56 seconds. If you want a second Codex
video later it should be a different demo, not a re-edit.

**This cut ends on the block, not on the audit tail.** The take recorded the
receipt beat, but a tmux repaint dropped 15 characters of the JSON line right
at the 105-column wrap, so the frame renders
`"classified":"Bash.git.pusheny"` — a string that does not exist in the log.
It's a rendering artifact, not a real decision. I cut the body before it
(`BODY_END` in the env) rather than caption over it. The other five terminal
casts were checked and are clean.

Publish it as-is; it stands on its own.

### The optional upgrade

A re-record gets the receipt beat back — `"client":"codex"` in the audit line
is the single strongest piece of evidence in the batch, because it's the log
saying "a different vendor's agent hit your rule". The episode script now
pipes the audit tail through `fold -w 100`, so the line can never reach the
wrap column again.

Same drill as last time, ~10 minutes:

```bash
cd ~/dev/acp-install-yt
demo/shoot-codex-install.sh
```

It prints a prereq check, preps a sandbox, then **pauses and prints ACTION
NEEDED**. Attach promptly — it aborts after 900s, which is what bit the first
attempt. In a SECOND terminal:

```bash
tmux attach -t acpdemo
```

Three dialogs may appear — handle only what you see:
1. `✨ Update available!` → choose **2 (Skip)**. The default is "Update now",
   which npm-installs a new Codex mid-recording and ruins the take.
2. `Do you trust the contents of this directory?` → **Yes**.
3. `Hooks need review` → choose **1 (Review hooks)**, then trust the ACP hook.

Then detach with **Ctrl-B, then D**. Do not Ctrl-C. It writes
`demo/codex-install.cast` (the current one is backed up as `.cast.bak`).

Tell me when it's done and I rebuild with the receipt beat restored. That
would be a second, better upload — not a replacement, since YouTube won't let
you swap a published file.

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
3. Merge + deploy marketing **PR #76** — this is now two things in one: the
   VideoObject schema that makes the demos already on the site eligible for
   Google video indexing, *and* the email-exposure fix at the top of this
   file. Commands are up there.
4. Merge acp-install **PR #17** (this kit) whenever you like — nothing
   depends on it being merged to publish.

Still to do on the free-distribution side, and it needs nothing from you —
say go and I'll do it: put these seven masters on their matching pages with
the same include, passing `transcript=` from each SRT. I have the target page
for every episode already (getting-started, the three incident posts, the
git-history post, `integrations/codex.md`, and the console post). That makes
each video a Google-indexable asset on our own domain independent of whether
the YouTube channel ever takes off.

## F. Not blocking anything, but open

- **The installer's own claim is on camera.** Every install video shows the
  line "The safety floor always blocks the catastrophic (rm -rf /, mkfs, dd,
  fork bombs, force-push to main) regardless of policy." Per #19 below that is
  currently overstated. The copy fix is minutes and it is the one change I'd
  make before these go public, because the footage repeats the claim six times.
- **amazonq has a Claude Code promo banner in frame.** From ~12s to ~67s of
  that take, the top of the terminal carries Anthropic's "Fable 5 is now a
  standard part of your Max plan" notice — which puts another company's
  marketing, and your plan tier, in our demo. Nothing secret, purely a taste
  call, and it's the only episode with it. It was a one-time notice, so a
  re-record would almost certainly come back clean: `demo/shoot-amazonq.sh`
  is unattended, then I re-time its captions. Say the word or leave it.

- **The classifier is visible in the receipts.** amazonq's audit line reads
  `"classified":"Bash.gcloud.>/dev/null"` and pocketos shows two lines with an
  empty `"classified":""` and no `"tool"` key at all. The denies land anyway,
  and I've put a plain note in amazonq's pinned comment rather than hope nobody
  reads it — but a viewer who looks will see the classifier splitting on the
  wrong token, which is #18's root cause.
- **acp-install #19 (p0)** — the safety floor is bypassed by `sudo -u`,
  `timeout N`, `nice -n N`, `git -C … push --force`, `( … )`. The installer's
  "regardless of policy" line is currently overstated. Copy fix is minutes;
  engine fix is ~a day using the gateway's `segmentBinary` as the port source.
- **acp-install #18** — policy denies bypassable by compound prefixing.
- Local vs cloud floor divergence: local treats force-push-to-main as
  hardline, the gateway does not (verified in `enforce` mode). Worth a ticket
  so the two floors agree.
