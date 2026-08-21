#!/usr/bin/env python3
"""overlay.py — text overlays for build.sh (this ffmpeg lacks drawtext).

  overlay.py card    <out.png> <line1> <line2> <line3>   # full 1920x1080 card
  overlay.py caption <out.png> <text> [--accent]         # lower-third pill, transparent
  overlay.py label   <out.png> <text>                    # small corner tag, transparent

Palette = dracula, matching the agg raster so cards and footage read as one.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

BG   = (40, 42, 54, 255)     # #282a36
BOX  = (25, 26, 33, 224)     # #191a21 @ ~88%
FG   = (248, 248, 242, 255)  # #f8f8f2
ACC  = (255, 85, 85, 255)    # #ff5555
DIM  = (154, 160, 176, 255)  # #9aa0b0
FONT = "/System/Library/Fonts/Menlo.ttc"

def font(size, bold=False):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)

def fit(draw, text, size, max_w, bold=False):
    f = font(size, bold)
    while size > 16 and draw.textlength(text, font=f) > max_w:
        size -= 2
        f = font(size, bold)
    return f

def card(out, l1, l2, l3):
    im = Image.new("RGBA", (1920, 1080), BG)
    d = ImageDraw.Draw(im)
    y = 430
    for text, size, color, bold in ((l1, 56, FG, True), (l2, 40, ACC, False), (l3, 28, DIM, False)):
        if not text:
            y += 90
            continue
        f = fit(d, text, size, 1700, bold)
        w = d.textlength(text, font=f)
        d.text(((1920 - w) / 2, y), text, font=f, fill=color)
        y += size + 52
    im.convert("RGB").save(out)

def caption(out, text, accent=False):
    tmp = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    f = fit(tmp, text, 34, 1700, bold=False)
    w = int(tmp.textlength(text, font=f))
    pad_x, pad_y = 26, 16
    im = Image.new("RGBA", (w + 2 * pad_x, f.size + 2 * pad_y + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=10, fill=BOX)
    d.text((pad_x, pad_y), text, font=f, fill=ACC if accent else FG)
    im.save(out)

def label(out, text):
    tmp = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    f = font(24)
    w = int(tmp.textlength(text, font=f))
    im = Image.new("RGBA", (w + 32, 24 + 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=8, fill=BOX)
    d.text((16, 11), text, font=f, fill=DIM)
    im.save(out)

def thumb(out, frame, title, tag):
    im = Image.open(frame).convert("RGBA").resize((1280, 720))
    d = ImageDraw.Draw(im)
    # darken lower band for legibility
    band = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.rectangle((0, 480, 1280, 720), fill=(15, 16, 21, 200))
    im = Image.alpha_composite(im, band)
    d = ImageDraw.Draw(im)
    tf_ = fit(d, tag, 54, 380, bold=True)
    tw = d.textlength(tag, font=tf_)
    d.rounded_rectangle((1280 - tw - 72, 36, 1280 - 24, 36 + 54 + 32), radius=12, fill=ACC)
    d.text((1280 - tw - 48, 36 + 16), tag, font=tf_, fill=(255, 255, 255, 255))
    f = fit(d, title, 64, 1180, bold=True)
    w = d.textlength(title, font=f)
    d.text(((1280 - w) / 2, 560), title, font=f, fill=FG)
    im.convert("RGB").save(out, quality=92)

if __name__ == "__main__":
    mode, out = sys.argv[1], sys.argv[2]
    if mode == "card":
        a = sys.argv[3:6] + [""] * (6 - len(sys.argv))
        card(out, a[0], a[1], a[2])
    elif mode == "caption":
        caption(out, sys.argv[3], accent="--accent" in sys.argv)
    elif mode == "label":
        label(out, sys.argv[3])
    elif mode == "thumb":
        thumb(out, sys.argv[3], sys.argv[4], sys.argv[5])
    else:
        sys.exit(f"unknown mode {mode}")
