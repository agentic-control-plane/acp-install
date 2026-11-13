#!/usr/bin/env node
// Post-install checks for .github/workflows/windows-live-install.yml.
//
//   node scripts/assert-windows-install.mjs <install-log> <exit-code>
//
// Run with the Windows node right after install.ps1 or install.sh, in the
// same job (one installer per clean runner). Exits 1 on any failure and
// prints what it looked at. Paths come from os.homedir(), which is the
// same directory for PowerShell (%USERPROFILE%) and Git Bash ($HOME), so
// the checks do not depend on the shell's path format.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [logPath, exitArg] = process.argv.slice(2);
const home = homedir();
let failed = 0;
const ok = (m) => console.log(`  PASS ${m}`);
const bad = (m, evidence) => {
  failed++;
  console.log(`  FAIL ${m}`);
  if (evidence) console.log(String(evidence).split("\n").map((l) => `       ${l}`).join("\n"));
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

console.log(`home: ${home}`);

// 1. The installer finished and got past the claude_code step.
const code = Number(exitArg);
code === 0 ? ok("installer exited 0") : bad(`installer exited ${exitArg}`);
let log = "";
try { log = readFileSync(logPath, "utf8"); } catch (e) { bad(`install log unreadable: ${logPath}`, e.message); }
if (log) {
  const died = log.match(/Install did not finish \(step: ([^,]+), exit (\d+)\)/);
  died ? bad(`installer reported failure at step ${died[1]} (exit ${died[2]})`) : ok("no 'Install did not finish' line");
  /\[Claude Code\] (ACP plugin|hooks \+ MCP registered directly)/.test(log)
    ? ok("claude_code step completed (plugin or direct hook wiring reported)")
    : bad("no Claude Code success line in the log: claude_code step did not complete");
  // Pre-seeded key + no terminal = the "keeping the existing key" finish.
  /keeping the existing key/.test(log) && /You're all set/.test(log)
    ? ok("finished on the existing-key path (no login attempted)")
    : bad("did not reach the existing-key finish (\"You're all set\")");
  // The pinned govern.mjs must land. A failed pinned fetch (e.g. native curl
  // handed an msys -o path) falls back to the bundled copy, which still
  // passes the size check below, so the log line is the evidence.
  const fellBack = log.split("\n").filter((l) => /using (the )?bundled copy/i.test(l));
  fellBack.length
    ? bad("govern.mjs fell back to the bundled copy (pinned fetch or verify failed)", fellBack.join("\n"))
    : ok("pinned govern.mjs installed (no 'using the bundled copy' line)");
}

// 2. Hook files exist.
const govern = join(home, ".acp", "govern.mjs");
existsSync(govern) && statSync(govern).size > 1000
  ? ok(`${govern} present (${statSync(govern).size} bytes)`)
  : bad(`${govern} missing or empty`);

// 3. ~/.claude/settings.json is valid JSON and wires the hook.
const settingsPath = join(home, ".claude", "settings.json");
let settings = null;
try { settings = readJson(settingsPath); ok(`${settingsPath} is valid JSON`); }
catch (e) { bad(`${settingsPath} missing or not valid JSON`, e.message); }

// Plugin path: the hook lives in the plugin's hooks.json; settings.json
// carries enabledPlugins. Direct path: settings.json carries govern.mjs.
function findPluginHooks(dir, depth = 0) {
  if (depth > 7 || !existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...findPluginHooks(p, depth + 1));
    else if (e.name === "hooks.json" && /agentic-control-plane|[\\/]acp[\\/]/.test(p)) out.push(p);
  }
  return out;
}
if (settings) {
  const raw = JSON.stringify(settings);
  const direct = ["PreToolUse", "PostToolUse"].every((ev) =>
    Array.isArray(settings.hooks?.[ev]) &&
    settings.hooks[ev].some((e) => (e.hooks || []).some((h) => typeof h.command === "string" && h.command.includes("govern.mjs"))));
  const pluginEnabled = settings.enabledPlugins?.["agentic-control-plane@acp"] === true;
  const pluginHooks = findPluginHooks(join(home, ".claude", "plugins"))
    .filter((p) => { try { return readFileSync(p, "utf8").includes("govern"); } catch { return false; } });
  if (direct) ok("settings.json wires govern.mjs on PreToolUse + PostToolUse (direct path)");
  else if (pluginEnabled && pluginHooks.length) ok(`ACP plugin enabled in settings.json; plugin hooks: ${pluginHooks[0]}`);
  else bad("settings.json carries no ACP hook (neither govern.mjs entries nor an enabled ACP plugin with hooks.json)", raw.slice(0, 1500));
  if (direct && pluginEnabled) bad("double governance: settings.json wires govern.mjs AND the plugin is enabled");
}

// 4. Second harness, informational only (the job's goal is Claude Code).
const codexHooks = join(home, ".codex", "hooks.json");
if (existsSync(codexHooks)) {
  try { readJson(codexHooks); console.log(`  info ${codexHooks} valid JSON`); }
  catch (e) { bad(`${codexHooks} is not valid JSON`, e.message); }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
