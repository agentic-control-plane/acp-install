#!/usr/bin/env python3
"""checksubs.py — structural checks on an episode's burned-in subtitles.

This catches the mechanical half of the QA pass: cues that run past the end of
the video, cues that overlap, cues that spill from the body onto the outro
card, and cues too long to read at their width. It cannot tell you whether a
caption describes the frame it plays over — that needs eyes on the frames, and
it is where every serious defect in this batch actually was.

    python3 checksubs.py                 # every episode with an SRT
    python3 checksubs.py codex-install-yt

Exit 1 if anything fails.
"""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIST = HERE / "dist"
EPS = HERE / "episodes"

# A cue is legible for roughly this many characters per second of screen time.
# Below it the viewer is still reading when the caption goes.
CPS_MAX = 21.0
MIN_SECS = 1.0


def dur(p: Path):
    if not p.exists():
        return None
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True,
    ).stdout.strip()
    return float(out) if out else None


def parse(srt: Path):
    cues, t = [], re.compile(
        r"(\d\d):(\d\d):(\d\d),(\d\d\d)\s*-->\s*(\d\d):(\d\d):(\d\d),(\d\d\d)")
    blocks = re.split(r"\n\s*\n", srt.read_text().strip())
    for b in blocks:
        lines = [l for l in b.splitlines() if l.strip()]
        if len(lines) < 2:
            continue
        m = t.search(lines[1] if t.search(lines[1] or "") else lines[0])
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        a = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        z = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        cues.append((a, z, " ".join(lines[2:]) if len(lines) > 2 else ""))
    return cues


def check(ep: str):
    srt = EPS / f"{ep}.srt"
    if not srt.exists():
        return []
    total = dur(DIST / f"{ep}-master-sub.mp4")
    cold = dur(DIST / f"{ep}.cold.mp4") or 0.0
    title = dur(DIST / f"{ep}.title.mp4") or 0.0
    body = dur(DIST / f"{ep}.body.mp4")
    body_end = (cold + title + body) if body else None

    bad = []
    cues = parse(srt)
    if not cues:
        return [f"{ep}: no cues parsed"]
    for i, (a, z, text) in enumerate(cues, 1):
        if z <= a:
            bad.append(f"{ep} cue {i}: ends before it starts")
        if total and z > total + 0.001:
            bad.append(f"{ep} cue {i}: ends {z:.1f}s, past the video ({total:.1f}s)")
        if z - a < MIN_SECS:
            bad.append(f"{ep} cue {i}: only {z - a:.1f}s on screen")
        if text and (z - a) > 0 and len(text) / (z - a) > CPS_MAX:
            bad.append(
                f"{ep} cue {i}: {len(text)} chars in {z - a:.1f}s "
                f"({len(text) / (z - a):.0f}/s, over {CPS_MAX:.0f}) — too fast to read")
        if body_end and a < body_end - 0.05 < z:
            bad.append(
                f"{ep} cue {i}: straddles the body/outro cut at {body_end:.1f}s "
                f"— it describes the terminal but finishes over the card")
        if i > 1 and a < cues[i - 2][1] - 0.001:
            bad.append(f"{ep} cue {i}: overlaps cue {i - 1}")
    return bad


def main():
    eps = sys.argv[1:] or sorted(p.stem for p in EPS.glob("*.srt"))
    fails = []
    for ep in eps:
        f = check(ep)
        print(f"{'FAIL' if f else 'ok  '}  {ep}")
        fails += f
    for f in fails:
        print("  -", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
