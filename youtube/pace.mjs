#!/usr/bin/env node
// pace.mjs <in.cast> <out.cast> <idleCap> <paceSpec> <tailHold>
// TIMING-ONLY transform (the bright line): trims the [exited] tail, caps
// idle gaps, applies per-window speed factors, appends a final hold.
// paceSpec: "a-b:f,c-d:f" — windows on the idle-capped speed-1 clock;
// factor f>1 compresses (delta/f), f<1 stretches.
import { readFileSync, writeFileSync } from 'node:fs';
const [inF, outF, capS, spec, holdS] = process.argv.slice(2);
const cap = parseFloat(capS), hold = parseFloat(holdS || '3.5');
const wins = (spec || '').split(',').filter(Boolean).map(w => {
  const m = w.match(/^([\d.]+)-([\d.]+):([\d.]+)$/);
  if (!m) { console.error(`bad pace window: ${w}`); process.exit(1); }
  return { a: +m[1], b: +m[2], f: +m[3] };
});
const lines = readFileSync(inF, 'utf8').split('\n').filter(Boolean);
const header = lines.shift();
// trim tail: cut at first [exited] event minus the clear before it
let cut = lines.findIndex(l => l.includes('exited'));
const body = cut > 3 ? lines.slice(0, cut - 1) : lines;
let t = 0; const out = [header];
for (const line of body) {
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  let d = Math.min(ev[0], cap);
  t += d;
  const w = wins.find(w => t > w.a && t <= w.b);
  if (w) d = d / w.f;
  out.push(JSON.stringify([Math.round(d * 1000) / 1000, ev[1], ev[2]]));
}
out.push(JSON.stringify([hold, 'o', '']));
writeFileSync(outF, out.join('\n') + '\n');
console.error(`paced → ${outF}`);
