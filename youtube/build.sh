#!/usr/bin/env bash
# youtube/build.sh — cast → YouTube-ready 1080p master (+ Shorts cut, + VO mux).
#
#   youtube/build.sh master <episode>     # dist/<ep>-master.mp4  (silent, VO-ready)
#   youtube/build.sh shorts <episode>     # dist/<ep>-short.mp4   (1080x1920, ≤60s)
#   youtube/build.sh vo     <episode>     # mux vo/<ep>.{wav,m4a,mp3} onto the master
#   youtube/build.sh beats  <episode>     # print the paced timeline (for VO scripts)
#
# Episodes live in youtube/episodes/<slug>.env — see force-push-yt.env.
#
# HONESTY BRIGHT LINE (inherited from demo/record.sh): the take is never
# doctored — no content is altered, reordered, or synthesized. This pipeline
# does exactly three kinds of things:
#   1. TIMING: idle caps and per-window speed (same class as agg --speed).
#   2. FRAMING: title card before, outro card after, labeled cold-open REPLAY
#      of a later moment ("REPLAY — full run follows" is burned into the
#      overlay so it can't read as the actual first event).
#   3. OVERLAYS: captions drawn OVER the footage, never pixels changed in it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEMO="$HERE/../demo"
DIST="$HERE/dist"; mkdir -p "$DIST"

FONT="/System/Library/Fonts/Menlo.ttc"
BG="0x282a36"          # dracula bg — matches the terminal raster
FG="0xf8f8f2"          # dracula fg
ACC="0xff5555"         # dracula red — the deny color
DIM="0x9aa0b0"
FPS=30

need() { command -v "$1" >/dev/null || { echo "missing: $1 (brew install $1)"; exit 1; }; }
need agg; need ffmpeg; need node

ep="${2:?usage: build.sh <master|shorts|vo|beats> <episode>}"
ENVF="$HERE/episodes/$ep.env"
[ -f "$ENVF" ] || { echo "no episode $ENVF"; exit 1; }
# shellcheck disable=SC1090
source "$ENVF"
CASTF="$DEMO/$CAST"
[ -f "$CASTF" ] || { echo "missing cast $CASTF"; exit 1; }

# ── pacing: trim dead tail, cap idles, per-window speed ────────────────
# All pacing happens HERE (agg then runs at speed 1 / no idle cap), so the
# paced cast's own clock IS the footage clock — beats.mjs stays exact.
paced() {
  local out="$1"
  node "$HERE/pace.mjs" "$CASTF" "$out" "${IDLE_CAP:-2.5}" "${PACE:-}" "${TAIL_HOLD:-3.5}"
}

png() { # png <name> <mode> <text...> — render overlay PNG, echo path
  local f="$DIST/.ov.$ep.$1.png"; shift
  python3 "$HERE/overlay.py" "$1" "$f" "${@:2}" ; echo "$f"
}

card() { # card <out.mp4> <seconds> <line1> <line2> <line3>
  local out="$1" secs="$2" p
  p="$(png "card$RANDOM" card "$3" "$4" "$5")"
  ffmpeg -y -loglevel error -loop 1 -i "$p" -t "$secs" -r $FPS -pix_fmt yuv420p "$out"
}

master() {
  local rc="$DIST/$ep.paced.cast" gif="$DIST/$ep.raw.gif" body="$DIST/$ep.body.mp4"
  paced "$rc"
  agg --font-size 24 --theme dracula "$rc" "$gif" 2>/dev/null
  # raster → 1080p canvas, terminal centered on dracula ground; callouts
  # composited as PNG lower-thirds with timed enable windows
  local base="scale=w=1856:h=1016:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=$BG,fps=$FPS"
  local inputs=(-i "$gif") fc="[0:v]$base[v0]" prev="v0" i=1
  while :; do
    local co; co="$(eval echo "\${CALLOUT_$i:-}")"; [ -n "$co" ] || break
    IFS='|' read -r a b txt <<<"$co"
    local cf; cf="$(png co$i caption "$txt")"
    inputs+=(-i "$cf")
    fc="$fc;[$prev][$i:v]overlay=x=(W-w)/2:y=H-120:enable='between(t,$a,$b)'[v$i]"
    prev="v$i"; i=$((i+1))
  done
  ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$fc" -map "[$prev]" \
    -pix_fmt yuv420p -crf 18 "$body"

  # cold open: labeled REPLAY of the payoff moment, then title card, then body
  local parts=()
  if [ -n "${COLDOPEN_START:-}" ]; then
    local cold="$DIST/$ep.cold.mp4"
    local rp hk; rp="$(png rp label 'REPLAY — full run follows')"; hk="$(png hk caption "$HOOK" --accent)"
    ffmpeg -y -loglevel error -ss "$COLDOPEN_START" -to "$COLDOPEN_END" -i "$body" -i "$rp" -i "$hk" \
      -filter_complex "[0:v][1:v]overlay=x=W-w-40:y=40[a];[a][2:v]overlay=x=(W-w)/2:y=H-170" \
      -pix_fmt yuv420p -crf 18 "$cold"
    parts+=("$cold")
  fi
  local title="$DIST/$ep.title.mp4" outro="$DIST/$ep.outro.mp4"
  card "$title" 3 "$TITLE1" "${TITLE2:-}" "agenticcontrolplane.com" 0
  card "$outro" 8 'curl -sf https://agenticcontrolplane.com/install.sh | bash' "${OUTRO2:-one command · no signup · full audit trail}" "$OUTRO_URL" 0
  parts+=("$title" "$body" "$outro")

  local list="$DIST/$ep.concat.txt"; : > "$list"
  for p in "${parts[@]}"; do echo "file '$p'" >> "$list"; done
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" -c copy "$DIST/$ep-master.mp4" 2>/dev/null || \
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" -pix_fmt yuv420p -crf 18 "$DIST/$ep-master.mp4"
  rm -f "$gif" "$list" "$DIST"/.ov.$ep.*.png
  echo "master → $DIST/$ep-master.mp4 ($(du -h "$DIST/$ep-master.mp4" | cut -f1))"
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$DIST/$ep-master.mp4" | awk '{printf "duration %d:%04.1f\n", $1/60, $1%60}'
}

shorts() {
  # vertical cut of the payoff: crop the LEFT 2/3 of the terminal (content is
  # left-aligned), scale to 1080 wide, stack on dracula ground.
  local body="$DIST/$ep.body.mp4"
  [ -f "$body" ] || { echo "run master first"; exit 1; }
  local s1 s2 s3
  s1="$(png s1 caption "$TITLE1")"; s2="$(png s2 caption "$HOOK" --accent)"; s3="$(png s3 label 'full video on the channel')"
  ffmpeg -y -loglevel error -ss "${SHORT_START:?}" -to "${SHORT_END:?}" -i "$body" -i "$s1" -i "$s2" -i "$s3" \
    -filter_complex "[0:v]crop=1280:1016:64:32,scale=1080:-2,pad=1080:1920:0:(oh-ih)/2:color=$BG[b];[b][1:v]overlay=x=(W-w)/2:y=200[c];[c][2:v]overlay=x=(W-w)/2:y=H-320[d];[d][3:v]overlay=x=(W-w)/2:y=H-220" \
    -pix_fmt yuv420p -crf 18 "$DIST/$ep-short.mp4"
  echo "short → $DIST/$ep-short.mp4"
}

vo() {
  local m="$DIST/$ep-master.mp4" a=""
  for ext in wav m4a mp3; do [ -f "$HERE/vo/$ep.$ext" ] && a="$HERE/vo/$ep.$ext" && break; done
  [ -n "$a" ] || { echo "no vo/$ep.{wav,m4a,mp3}"; exit 1; }
  ffmpeg -y -loglevel error -i "$m" -i "$a" -c:v copy -c:a aac -b:a 192k \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" -shortest "$DIST/$ep-final.mp4"
  echo "final → $DIST/$ep-final.mp4"
}

thumb() {
  local body="$DIST/$ep.body.mp4"
  [ -f "$body" ] || { echo "run master first"; exit 1; }
  local fr="$DIST/.thumb.$ep.frame.png"
  ffmpeg -y -loglevel error -ss "${THUMB_T:?}" -i "$body" -frames:v 1 "$fr"
  python3 "$HERE/overlay.py" thumb "$DIST/$ep-thumb.png" "$fr" "${THUMB_TITLE:-$TITLE1}" "${THUMB_TAG:-BLOCKED}"
  rm -f "$fr"; echo "thumb → $DIST/$ep-thumb.png"
}

beats() {
  local rc="$DIST/$ep.paced.cast"; paced "$rc"
  echo "(times are FOOTAGE clock; add title-card 3.0s + cold-open length for master clock)"
  node "$HERE/transcript.mjs" "$rc" 99999 1 | awk 'NR%1==0'
}

case "${1:-}" in
  master) master ;;
  thumb)  thumb ;;
  shorts) shorts ;;
  vo)     vo ;;
  beats)  beats ;;
  *) sed -n '2,10p' "$0" ;;
esac
