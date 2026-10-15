# Adding an episode

Seven episodes in, the shape is stable. A new harness is four files and one
recording. This is what they are, in the order you write them.

## The four files

| File | What it is |
|---|---|
| `demo/episodes/<slug>.sh` | The take. Drives the harness in a sandbox and records an asciinema cast. |
| `youtube/episodes/<slug>-yt.env` | The video: pacing, title/outro cards, cold open, thumbnail frame, Shorts crop. |
| `youtube/episodes/<slug>-yt.srt` | The captions. Also the caption track uploaded to YouTube, and the transcript on the site. |
| `youtube/metadata/<slug>-yt.md` | The upload pack: title, description, tags, chapters, pinned comment. |

Then:

```bash
demo/shoot-<slug>.sh                          # record
cd youtube
./build.sh beats <slug>-yt                    # where each beat lands, footage clock
SUBS=1 ./build.sh master <slug>-yt            # write the SRT against those numbers
./build.sh shorts <slug>-yt && ./build.sh thumb <slug>-yt
python3 checksubs.py <slug>-yt                # must pass
```

## The two episode shapes

**A. Harness install (~75s).** Install, what got installed, normal work
allowed, a destructive call denied, the audit receipt. This is the one that
ranks — it answers "how do I control X". One per harness.

**B. Incident recreation (~75s).** A pretext that would convince a careful
agent — a runbook, a ticket, a deadline — then the deny, then the receipt. The
argument is always *the hard case is a convinced agent, not a malicious one*.
Only for incidents ACP would actually have prevented.

Two others exist and don't generalize the same way: the console tour (a
screencast, `VIDEO=` instead of `CAST=`, from `~/dev/console-shot-rig`) and the
cross-vendor cut (one install, two agents, same rule).

## The honesty line

The pipeline is allowed to change **timing** (idle caps, per-window speed,
`TAIL_PAD`, `BODY_END`), **framing** (title and outro cards, a cold open
labelled `REPLAY — full run follows`), and **overlays** (captions). It never
alters, reorders or re-types what happened.

Which means:

- A bad take is re-recorded, never patched. If a frame is wrong, cut to before
  it (`BODY_END`) or shoot again.
- The rig never forges a security step. Codex's hook trust is a human step
  because trusting a hook is Codex's security model; faking it would be lying
  about the one thing that episode teaches.
- **Captions may not claim more than the frame shows.** This is where every
  serious defect in the first batch was. Two episodes said the destructive
  command died at the hook when the footage showed a read-only probe dying;
  a viewer reading the terminal would have caught it.

## The QA gate — both halves, every time

`checksubs.py` catches the mechanical half: cues past the end, overlaps (two
caption boxes drawn at once), cues straddling the body/outro cut, and cues too
dense to read. It must pass.

It cannot tell you whether a caption describes the frame it plays over. That
needs eyes: pull a frame at each cue's midpoint and read it.

```bash
ffmpeg -y -v error -ss <t> -i dist/<slug>-yt-master-sub.mp4 -frames:v 1 \
  -vf scale=1200:-2 /tmp/qa-<t>.png
```

Things that have actually gone wrong and are worth checking for by name:

- **Captions ahead of the action.** SRTs written against intended pacing rather
  than the final paced cast ran 2–6s early in five of seven episodes.
- **The receipt obscured.** The audit line is the proof, it lands at the bottom
  of the terminal, and the caption box sits exactly there. Every episode needs
  `TAIL_PAD` so it stays readable after the caption clears.
- **A corrupted frame.** A tmux repaint once dropped 15 characters at the
  105-column wrap, rendering `"classified":"Bash.git.pusheny"` — a string not
  in the log. Episode scripts now pipe the audit tail through `fold -w 100` so
  it can't reach the wrap column; check anyway.
- **A beat that silently didn't happen.** An `await` matching the bare words
  `ask` or `Allow` matches "task" and "Allowed", returns instantly, and the
  beat is skipped with nothing on screen to say so. Match the ACP reason line.

## Console recordings, additionally

Read real frames at **native** resolution before publishing. Two leaks got past
a "looks fine" review: an operator email published on the marketing site for
weeks, and an `apikey:<uuid>` on the Approvals card that was one upload away.
The rig masks emails, UUIDs and token-shaped strings continuously and aborts
rather than record unmasked — but the mask has no opinion about free text, and
free text is why the Policies beat is cut from the tour.

## Landing it

YouTube is one destination and it needs a human. The other needs nobody: the
same master, re-encoded at 1440/CRF 30, goes on the page that already ranks for
that question via `{% include demo-video.html %}` in the marketing repo, with
the SRT flattened into `transcript=`. These videos have no audio, so that
transcript is the only text either YouTube or an answer engine ever gets.
