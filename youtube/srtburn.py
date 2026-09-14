#!/usr/bin/env python3
"""srtburn.py <srt> — emit 'start|end|text' lines for build.sh sub burning."""
import re, sys
txt = open(sys.argv[1]).read()
def sec(t):
    h, m, rest = t.split(':'); s, ms = rest.split(',')
    return int(h)*3600 + int(m)*60 + int(s) + int(ms)/1000
for block in re.split(r'\n\s*\n', txt.strip()):
    lines = block.strip().split('\n')
    if len(lines) < 3: continue
    a, b = [sec(x.strip()) for x in lines[1].split('-->')]
    print(f"{a}|{b}|{' '.join(l.strip() for l in lines[2:])}")
