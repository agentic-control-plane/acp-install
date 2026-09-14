#!/usr/bin/env node
// transcript.mjs <cast> <idle> <speed> — cleaned text with OUTPUT timecodes, second-bucketed
import { readFileSync } from 'node:fs';
const [cast, idleS, speedS] = process.argv.slice(2);
const idle = parseFloat(idleS), speed = parseFloat(speedS);
const lines = readFileSync(cast, 'utf8').split('\n').filter(Boolean); lines.shift();
let tOut = 0; const buckets = new Map();
for (const line of lines) {
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  const [t, kind, data] = ev;
  tOut += Math.min(t, idle) / speed;
  if (kind !== 'o') continue;
  const clean = data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/[\x00-\x08\x0b-\x1f]/g, '');
  if (!clean.trim()) continue;
  const b = Math.floor(tOut);
  buckets.set(b, (buckets.get(b) || '') + clean);
}
for (const [b, txt] of buckets) {
  const t = txt.replace(/\s+/g, ' ').trim().slice(0, 220);
  if (t) console.log(`${String(Math.floor(b/60))}:${String(b%60).padStart(2,'0')}  ${t}`);
}
