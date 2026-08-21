# youtube/ — the video production kit

Turns the real demo casts in `demo/` into YouTube-ready videos: 1080p
master (title card + labeled cold-open replay + callout overlays + outro),
custom thumbnail, vertical Short, and a VO mux step.

    youtube/build.sh master <episode>   # dist/<ep>-master.mp4 (silent)
    youtube/build.sh thumb  <episode>   # dist/<ep>-thumb.png (1280x720)
    youtube/build.sh shorts <episode>   # dist/<ep>-short.mp4 (1080x1920)
    youtube/build.sh vo     <episode>   # + vo/<ep>.m4a → dist/<ep>-final.mp4
    youtube/build.sh beats  <episode>   # paced timeline (for VO scripts)

Episodes: `episodes/<slug>.env` (cast, pacing, cards, callouts, cold-open /
Shorts / thumbnail windows). VO scripts: `scripts/`. Upload packs
(title/description/tags/chapters/captions/settings): `metadata/`. David's
end-to-end checklist: `RUNBOOK.md`.

Requirements: `brew install agg ffmpeg` (any build — text is rendered via
PIL, not drawtext), node 18+, python3 with Pillow.

## The honesty bright line

Inherited from `demo/record.sh` and non-negotiable for a control-layer
product: **takes are never doctored.** This pipeline only ever
1. adjusts **timing** (idle caps, per-window speed — same class as
   `agg --speed`; `pace.mjs` is the whole transform, read it),
2. adds **framing** (cards before/after; the cold open is a replay of a
   later moment with "REPLAY — full run follows" burned in),
3. draws **overlays** on top of footage (never altering pixels beneath).

If a take is wrong, re-record it (`demo/record.sh` / the shoot scripts).

## Timing model

`pace.mjs` produces `dist/<ep>.paced.cast`; agg renders it 1:1, so the
paced cast's clock IS the footage clock. `beats.mjs <cast> 99999 1
name=regex ...` maps content to footage timecodes (it replays the same
transform and greps a rolling cleaned-output buffer). PACE windows in the
.env are on the **idle-capped, speed-1** clock — i.e. run `beats.mjs
../demo/<cast> 2.5 1` to choose them, then verify on the paced cast.
Master clock = cold-open length + 3s title + footage clock.

## Adding an episode

1. Record via the demo rig (`demo/record.sh record <episode>` or a shoot
   script). Never fake a take.
2. `cp episodes/claude-install-yt.env episodes/<new>.env`, point CAST at
   the new cast, clear the window fields.
3. `build.sh beats <new>` → pick PACE windows and beat anchors.
4. Set callouts/cold-open/Shorts/thumb from the beat times; build; QA
   frames (`ffmpeg -ss <t> -i dist/<new>-master.mp4 -frames:v 1 f.png`).
5. Write `scripts/<new>-vo.md` + `metadata/<new>.md` following the
   existing ones (description = mini blog post; UTM on every link;
   `utm_campaign=<episode-slug>`).
