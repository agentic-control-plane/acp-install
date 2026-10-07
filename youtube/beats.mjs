#!/usr/bin/env node
// beats.mjs — map cast content to OUTPUT-video timecodes.
// Replays agg's transform (idle-time-limit cap, speed divide) over an
// asciinema v3 cast, accumulating output text in a rolling buffer, and prints
// the output-time at which each named regex FIRST matches.
//
// Usage: node beats.mjs <cast> <idle> <speed> name=regex [name=regex ...]
//        node beats.mjs <cast> <idle> <speed> --duration
import { readFileSync } from 'node:fs';

const [cast, idleS, speedS, ...specs] = process.argv.slice(2);
const idle = parseFloat(idleS), speed = parseFloat(speedS);
const lines = readFileSync(cast, 'utf8').split('\n').filter(Boolean);
lines.shift(); // header

// v3 casts carry per-event DELTAS already; detect v2 (absolute) just in case.
let tOut = 0, buf = '';
const want = specs.filter(s => s.includes('=')).map(s => {
  const i = s.indexOf('=');
  return { name: s.slice(0, i), re: new RegExp(s.slice(i + 1)), at: null };
});
let prevAbs = 0, absolute = false;
// sniff: if timestamps are monotonically increasing beyond plausible deltas, treat as absolute
const ts = lines.slice(0, 50).map(l => JSON.parse(l)[0]);
if (ts.length > 5 && ts.every((t, i) => i === 0 || t >= ts[i - 1]) && ts[ts.length - 1] > 60) absolute = true;

for (const line of lines) {
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  const [t, kind, data] = ev;
  const delta = absolute ? Math.max(0, t - prevAbs) : t;
  if (absolute) prevAbs = t;
  tOut += Math.min(delta, idle) / speed;
  if (kind !== 'o') continue;
  buf = (buf + data).slice(-8000);
  const clean = buf.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  for (const w of want) if (w.at === null && w.re.test(clean)) w.at = tOut;
}
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
for (const w of want) console.log(`${w.name}\t${w.at === null ? 'NO MATCH' : fmt(w.at) + '\t' + w.at.toFixed(2)}`);
if (specs.includes('--duration') || want.length === 0) console.log(`duration\t${fmt(tOut)}\t${tOut.toFixed(2)}`);
