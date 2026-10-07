// Console VIDEO rig — records the real ACP console as an mp4/gif.
//
// Companion to shoot.mjs (stills). Same logged-in Chrome profile snapshot at
// ~/.acp/chrome-shot-profile, same pipe transport, same "it's the real product
// or it doesn't ship" rule as the terminal rig in acp-install/demo.
//
// Why CDP screencast and not a page.screenshot() loop: screenshot() costs
// 100-300ms a frame and stalls the renderer, so a scroll recorded that way
// judders and lies about how the product feels. Page.startScreencast streams
// frames off the compositor with real presentation timestamps; we keep those
// timestamps and hand them to ffmpeg's concat demuxer, so the output plays at
// true speed. Nothing is interpolated, retimed, or dropped except leading and
// trailing dead air.
//
// Usage:
//   node record-console.mjs <scene.mjs> [--out NAME] [--fps 30] [--keep-frames]
//
// A scene is a module exporting { name, viewport?, hide?, steps }. See
// scenes/cost-xray.mjs. Steps are plain objects, executed in order:
//
//   { goto: url }                       navigate, wait for network idle
//   { waitFor: "text" }                 wait until the text appears
//   { waitGone: "Loading..." }          wait until the text is gone
//   { tenant: "dcroweua" }              switch workspace via the AppShell select
//   { dwell: 2000 }                     hold the current frame (ms)
//   { scrollTo: "css", ms: 1200 }       eased scroll until the element is in view
//   { scrollBy: 600, ms: 900 }          eased scroll by N px
//   { hover: "css" }                    move the real cursor onto an element
//   { click: "css" }                    click it
//   { type: {sel, text, ms} }           type into a field at human speed
//
// Restore note: { tenant } writes the active workspace to the user's own
// console state. A scene that switches workspaces MUST end with a tenant step
// putting it back, or the next person to open the console lands somewhere they
// didn't leave it. record-console.mjs prints the tenant it found on entry so a
// mis-restored run is obvious in the log.

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const scenePath = args[0];
if (!scenePath) {
  console.error("usage: node record-console.mjs <scene.mjs> [--out NAME] [--fps 30] [--keep-frames]");
  process.exit(1);
}
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const keepFrames = args.includes("--keep-frames");
const fps = parseInt(opt("--fps", "30"), 10);

const scene = await import(path.resolve(scenePath));
const NAME = opt("--out", scene.name || path.basename(scenePath, ".mjs"));
const VP = { width: 1600, height: 900, deviceScaleFactor: 2, ...(scene.viewport || {}) };

const OUT = path.resolve("out");
const FRAMES = path.join(OUT, `${NAME}-frames`);
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

// Cosmetic chrome only — the same call the terminal rig makes when it turns off
// the tmux status bar. Hiding the support bubble is allowed; hiding product
// state, numbers, or decisions is not. Everything hidden is logged.
const MASK = scene.mask !== false;   // scenes opt out with `export const mask = false`
const HIDE = scene.hide ?? ['[class*="intercom"]', '[id*="intercom"]', '[class*="chat-widget"]', '[aria-label*="Open chat"]'];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  pipe: true,
  userDataDir: path.join(os.homedir(), ".acp", "chrome-shot-profile"),
  args: [
    "--profile-directory=Default",
    "--hide-scrollbars",
    "--disable-gpu",
    "--force-prefers-reduced-motion=0",
    `--window-size=${VP.width},${VP.height}`,
  ],
  defaultViewport: VP,
});

const page = await browser.newPage();
const cdp = await page.createCDPSession();

// Set once a { tenant } step pins a workspace. While set, any { goto } is a
// hard error — see the note above selectTenant.
let tenantPinned = null;

// ── frame capture ─────────────────────────────────────────────────────
const frames = []; // { file, t } — t is the compositor's presentation time (s)
let frameNo = 0;
let capturing = false;

cdp.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* torn down */ }
  if (!capturing) return;
  const file = path.join(FRAMES, `f${String(frameNo++).padStart(5, "0")}.png`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
});

async function startCapture() {
  capturing = true;
  await cdp.send("Page.startScreencast", {
    format: "png",
    maxWidth: VP.width * VP.deviceScaleFactor,
    maxHeight: VP.height * VP.deviceScaleFactor,
    everyNthFrame: 1,
  });
}
async function stopCapture() {
  capturing = false;
  try { await cdp.send("Page.stopScreencast"); } catch { /* already gone */ }
}

// A screencast only emits frames when the compositor produces them — a page
// sitting still produces nothing. Dwells therefore need a heartbeat, or a
// 3-second hold on the payoff would collapse to a single frame with no
// duration. A 1px transform nudge forces a cheap recomposite without moving
// anything visible.
async function dwell(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.evaluate(() => {
      document.documentElement.style.transform = "translateZ(0)";
      void document.documentElement.offsetHeight;
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The support bubble is a bare <button> — no class, no id, no aria-label — so
// selectors can't find it. Match it structurally instead: a small fixed-
// position element pinned to a viewport corner is chrome, never product state.

// Mask personal identifiers before any frame is captured. The console
// legitimately shows the operator's email in IDENTITY columns and approval
// cards; a public video must not. A one-shot text-node walk is not enough —
// the console re-renders rows constantly and React restores the original
// text — so this installs a MutationObserver that re-masks on every mutation
// and survives client-side navigation (document.body persists in the SPA).
// Uses the product's own mask shape; character count stays realistic so
// layout doesn't shift.
// Masking is a privacy control, so it fails loud. A client-side navigation can
// detach the frame mid-call ("Attempted to use detached Frame"); that is a race
// worth retrying. Anything that survives a retry stops the recording — a take
// that silently continued unmasked is exactly how an operator email ended up
// published on the marketing site.
async function applyMask() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await applyMaskOnce();
    } catch (err) {
      const detached = /detached Frame|Execution context was destroyed|Target closed/i
        .test(String(err && err.message));
      if (detached && attempt < 3) {
        await sleep(250);
        continue;
      }
      throw new Error(
        `masking failed (${err && err.message}) — refusing to keep recording ` +
        `unmasked. Nothing was written.`,
      );
    }
  }
}

async function applyMaskOnce() {
  await page.evaluate(() => {
    if (window.__acpMaskOn) { window.__acpMaskSweep(); return; }
    const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
    const maskEmail = (_m, first, domain) => first + "*".repeat(12) + domain.slice(-3);
    // Credential identifiers. The Approvals card renders the requesting
    // identity as `apikey:<uuid>`; a console tour published with that intact
    // puts a live workspace credential id on YouTube. Masking emails alone is
    // not enough — this was found on a frame already marked publish-ready.
    // Keep the shape (so the UI still reads as an api key) and the last 4.
    const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
    const LONGTOK = /\b(?:acp|sk|pk|key|tok)[_-][A-Za-z0-9_-]{16,}\b/g;
    const maskTail = (m) => "•".repeat(8) + m.slice(-4);
    const sweep = () => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      while (walk.nextNode()) {
        const n = walk.currentNode;
        if (!n.nodeValue) continue;
        const v = n.nodeValue;
        if (v.indexOf("@") !== -1 || UUID.test(v) || LONGTOK.test(v)) hits.push(n);
        UUID.lastIndex = 0; LONGTOK.lastIndex = 0;
      }
      for (const n of hits) {
        EMAIL.lastIndex = 0; UUID.lastIndex = 0; LONGTOK.lastIndex = 0;
        const next = n.nodeValue
          .replace(EMAIL, maskEmail)
          .replace(UUID, maskTail)
          .replace(LONGTOK, maskTail);
        if (next !== n.nodeValue) n.nodeValue = next;
      }
    };
    window.__acpMaskSweep = sweep;
    const obs = new MutationObserver(() => {
      // Re-entrancy guard: our own nodeValue writes trigger the observer.
      if (window.__acpMasking) return;
      window.__acpMasking = true;
      try { sweep(); } finally { window.__acpMasking = false; }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__acpMaskOn = true;
    sweep();
  });
}

async function applyHide() {
  const hidden = await page.evaluate((sels) => {
    const hit = [];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        el.style.setProperty("display", "none", "important");
        hit.push(s);
      }
    }
    for (const el of document.querySelectorAll("body *")) {
      if (getComputedStyle(el).position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.width > 140 || r.height > 140) continue;
      if (r.bottom > innerHeight - 160 && r.right > innerWidth - 160) {
        el.style.setProperty("display", "none", "important");
        hit.push(`corner-widget<${el.tagName.toLowerCase()}>`);
      }
    }
    return hit;
  }, HIDE).catch(() => []);
  if (hidden.length) console.log("  hidden (cosmetic):", [...new Set(hidden)].join(", "));
}

async function currentTenant() {
  return page.evaluate(() => {
    const sel = document.querySelector("select");
    if (!sel) return null;
    return sel.options[sel.selectedIndex]?.textContent.trim() ?? null;
  }).catch(() => null);
}

// WORKSPACE SWITCHING — the one rule that matters:
// after a { tenant } step, navigate with { navClick }, NEVER with { goto }.
//
// Why. In this profile TenantProvider's read of users/{uid}.activeTenantId
// silently fails, so it falls through to its last resort — "most recently
// joined membership wins" — and lands on whatever workspace was created last,
// no matter what the server says the preference is. (Verified: the server had
// dcroweua while the app kept resolving to tau2-stress-test.)
//
// The picker itself works fine: page.select() fires React's onChange and the
// provider holds that value for the life of the page, because the resolver
// keeps `prev` whenever it's still a valid membership. So the switch survives
// client-side navigation and dies on any full page load. { goto } after a
// { tenant } step throws rather than quietly recording the wrong workspace.
async function selectTenant(text) {
  if (page.url() === "about:blank" || !page.url().includes("agenticcontrolplane")) {
    await page.goto("https://cloud.agenticcontrolplane.com/home", { waitUntil: "networkidle2", timeout: 60_000 });
  }
  await page.waitForSelector("select", { timeout: 30_000 });
  await sleep(2500);
  const found = await page.evaluate((wanted) => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent.trim().toLowerCase() === wanted.toLowerCase()));
    if (!sel) return null;
    const opt = [...sel.options].find((o) => o.textContent.trim().toLowerCase() === wanted.toLowerCase());
    if (!sel.id) sel.id = "acp-tenant-select";
    return { sel: "#" + sel.id, value: opt.value, already: sel.value === opt.value };
  }, text);
  if (!found) throw new Error(`no workspace named "${text}" in the picker`);
  if (found.already) { console.log(`  tenant: already ${text}`); tenantPinned = text; return; }

  await page.select(found.sel, found.value);
  await sleep(4000);
  const now = await currentTenant();
  if (!now || now.toLowerCase() !== text.toLowerCase()) {
    throw new Error(`workspace switch failed (wanted ${text}, picker shows ${now})`);
  }
  console.log(`  tenant: switched to ${now} (client-side only — no goto from here)`);
  tenantPinned = text;
}

// Click a link or button by its visible text and let the SPA route. Used
// instead of goto once a workspace is pinned.
async function navClick(text, waitMs = 6000) {
  const r = await page.evaluate((t) => {
    const els = [...document.querySelectorAll("a, button, [role=tab], [role=button]")];
    const el = els.find((e) => e.textContent.trim() === t) || els.find((e) => e.textContent.trim().startsWith(t));
    if (!el) return "not-found";
    el.click();
    return "clicked";
  }, text);
  if (r === "not-found") throw new Error(`navClick: nothing matching "${text}"`);
  await sleep(waitMs);
}

// Eased scrolling, driven frame by frame so the screencast sees real motion.
// window.scrollTo({behavior:"smooth"}) is not usable here: its duration is
// UA-controlled and it silently no-ops under reduced-motion.
async function easeScroll(targetY, ms) {
  const startY = await page.evaluate(() => window.scrollY);
  const dist = targetY - startY;
  if (Math.abs(dist) < 2) return;
  const steps = Math.max(2, Math.round((ms / 1000) * fps));
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(startY + dist * e));
    await sleep(1000 / fps);
  }
}

async function run() {
  const steps = scene.steps;
  let entryTenant = null;

  for (const [i, step] of steps.entries()) {
    const label = Object.keys(step).filter((k) => k !== "ms").join("+");
    console.log(`[${i + 1}/${steps.length}] ${label}`);

    if (step.goto) {
      if (tenantPinned) {
        throw new Error(
          `{ goto } after { tenant: "${tenantPinned}" } would reload the page and ` +
          `reset the workspace to the wrong one. Use { navClick: "..." } instead.`
        );
      }
      await page.goto(step.goto, { waitUntil: "networkidle2", timeout: 60_000 });
      await applyHide();
      if (entryTenant === null) entryTenant = await currentTenant();
    }
    if (step.tenant) {
      if (entryTenant === null) entryTenant = await currentTenant();
      await selectTenant(step.tenant);
      await applyHide();
    }
    if (step.navClick) {
      await navClick(step.navClick, step.ms ?? 6000);
      await applyHide();
    }
    if (step.waitFor) {
      await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 60_000 }, step.waitFor)
        .catch(() => console.error(`  warn: "${step.waitFor}" never appeared — continuing`));
      await applyHide();
    }
    if (step.waitGone) {
      await page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout: 60_000 }, step.waitGone)
        .catch(() => console.error(`  warn: "${step.waitGone}" still present — continuing`));
    }
    // Capture starts on the first `record: true` step, so navigation and
    // workspace switching never land in the artifact.
    if (step.record) {
      if (MASK) await applyMask(); await applyHide(); await startCapture(); }
    if (step.dwell) await dwell(step.dwell);
    if (step.scrollTo) {
      const y = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return window.scrollY + el.getBoundingClientRect().top - 80;
      }, step.scrollTo);
      if (y === null) console.error(`  warn: no element for ${step.scrollTo} — skipping scroll`);
      else await easeScroll(y, step.ms ?? 1200);
    }
    if (step.scrollBy) {
      const y = await page.evaluate(() => window.scrollY);
      await easeScroll(y + step.scrollBy, step.ms ?? 900);
    }
    // Sort a table by a column header, descending. Headers are toggles, so
    // click until the arrow reads descending (max 3 tries), then report what
    // rose to the top — a scene that silently records a boring run is worse
    // than one that fails.
    if (step.sortBy) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await page.evaluate((col) => {
          const th = [...document.querySelectorAll("th")].find((t) =>
            t.innerText.trim().toLowerCase().startsWith(col.toLowerCase()));
          if (!th) return "no-header";
          if (th.innerText.includes("▼")) return "desc";
          (th.querySelector("button, [role=button]") || th).click();
          return "clicked";
        }, step.sortBy);
        if (state === "no-header") { console.error(`  warn: no "${step.sortBy}" column`); break; }
        if (state === "desc") break;
        await sleep(1500);
      }
      await sleep(2000);
      const top = await page.evaluate(() =>
        [...document.querySelectorAll("tbody tr")].slice(0, 3).map((tr) => ({
          row: tr.innerText.replace(/\s*\n\s*/g, " · ").slice(0, 110),
          href: tr.querySelector("a")?.getAttribute("href") ?? null,
        })));
      console.log(`  sorted by ${step.sortBy} — top rows:`);
      for (const t of top) console.log(`    ${t.href ?? "?"}  ${t.row}`);
      if (top[0] && /·\s*—\s*·/.test(top[0].row)) {
        console.error(
          "  ⚠ the priciest run in this workspace has no cost. Nothing here was\n" +
          "    metered through the proxy, so there are no dollars to show. Switch\n" +
          "    the console to a workspace with proxy-routed model calls and re-run."
        );
      }
    }
    if (step.hover) {
      const el = await page.$(step.hover);
      if (!el) console.error(`  warn: no element for ${step.hover}`);
      else { await el.hover(); await dwell(step.ms ?? 400); }
    }
    if (step.click) {
      const el = await page.$(step.click);
      if (!el) console.error(`  warn: no element for ${step.click}`);
      else { await el.click(); await dwell(step.ms ?? 800); }
    }
    // clickText: click the nth (default first) element whose own text matches,
    // for controls a CSS selector can't name — a disclosure toggle, a tab.
    // Refuses anything that reads like a state change: a scene must never
    // approve, reject, confirm or delete on a live console. Deliberately not a
    // safety boundary you can argue with — add a selector-based click if you
    // genuinely need one, so it's visible in review.
    if (step.clickText) {
      const FORBIDDEN = /^(approve|deny|reject|confirm|delete|remove|revoke|apply|save|submit|enable|disable)\b/i;
      if (FORBIDDEN.test(step.clickText.trim())) {
        throw new Error(`clickText refuses "${step.clickText}" — scenes do not change state on a live console`);
      }
      const idx = step.nth ?? 0;
      const ok = await page.evaluate((t, n, forbidden) => {
        const want = t.trim().toLowerCase();
        const re = new RegExp(forbidden, "i");
        const hits = [];
        for (const el of document.querySelectorAll("summary,button,a,[role=button],details>*")) {
          const own = (el.textContent || "").trim();
          if (!own || own.length > 80) continue;
          if (!own.toLowerCase().includes(want)) continue;
          if (re.test(own)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          hits.push(el);
        }
        const el = hits[n];
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      }, step.clickText, idx, FORBIDDEN.source).catch(() => false);
      if (!ok) console.error(`  warn: no clickable text "${step.clickText}" (nth=${idx})`);
      await dwell(step.ms ?? 800);
    }
    if (step.type) {
      await page.click(step.type.sel);
      for (const ch of step.type.text) {
        await page.keyboard.type(ch);
        await sleep(step.type.ms ?? 45);
      }
    }
    // Client-side navigation re-mounts the support widget, so re-hide after
    // every step rather than only on load. Idempotent and cheap.
    if (capturing) { await applyHide(); if (MASK) await applyMask(); }
  }

  await stopCapture();

  if (entryTenant) {
    const now = await currentTenant();
    console.log(`\nworkspace: resolved to ${entryTenant} on load · recorded ${now}`);
    // No restore step needed: the switch lives in React state for the life of
    // the page and is never written back, so nothing outside this run changed.
  }
}

try {
  await run();
} finally {
  await stopCapture();
  await browser.close();
}

// ── assemble ──────────────────────────────────────────────────────────
if (!frames.length) {
  console.error("no frames captured — did the scene include a { record: true } step?");
  process.exit(1);
}

// Real per-frame durations from the compositor's timestamps. The last frame
// gets the median duration (there's no next timestamp to subtract from).
const durs = [];
for (let i = 0; i < frames.length - 1; i++) durs.push(Math.max(1 / 120, frames[i + 1].t - frames[i].t));
const median = durs.length ? [...durs].sort((a, b) => a - b)[Math.floor(durs.length / 2)] : 1 / fps;
durs.push(median);

const listFile = path.join(FRAMES, "frames.txt");
let list = "";
for (let i = 0; i < frames.length; i++) {
  list += `file '${path.basename(frames[i].file)}'\nduration ${durs[i].toFixed(4)}\n`;
}
list += `file '${path.basename(frames[frames.length - 1].file)}'\n`; // concat demuxer quirk
fs.writeFileSync(listFile, list);

const mp4 = path.join(OUT, `${NAME}.mp4`);
const gif = path.join(OUT, `${NAME}.gif`);
const total = frames.reduce((a, _, i) => a + durs[i], 0);

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", listFile,
  "-vf", `fps=${fps},scale=1920:-2:flags=lanczos`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20",
  "-movflags", "faststart", "-pix_fmt", "yuv420p",
  mp4,
], { stdio: "inherit" });

// GIF for the README / blog embeds, where video can't autoplay.
const pal = path.join(FRAMES, "pal.png");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", "fps=12,scale=1000:-1:flags=lanczos,palettegen=stats_mode=diff", pal], { stdio: "inherit" });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-i", pal, "-lavfi", "fps=12,scale=1000:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3", gif], { stdio: "inherit" });

const mb = (p) => (fs.statSync(p).size / 1e6).toFixed(1) + "MB";
console.log(`\nframes: ${frames.length} · ${total.toFixed(1)}s`);
console.log(`mp4 → ${mp4} (${mb(mp4)})`);
console.log(`gif → ${gif} (${mb(gif)})`);
if (!keepFrames) fs.rmSync(FRAMES, { recursive: true, force: true });
else console.log(`frames kept → ${FRAMES}`);
