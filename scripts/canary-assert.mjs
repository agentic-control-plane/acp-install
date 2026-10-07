#!/usr/bin/env node
// Harness canary assertions. Three subcommands:
//
//   invariants --harness <id>
//     The installer wrote exactly what it should for this harness, once.
//     This is the whole canary for the invariants-only legs (codex, grok,
//     dsh, hermes, openclaw, muse; see docs/harness-canary.md for why).
//
//   audit --harness <id> --since <iso Z> [--marker <m>] [--timeout <s>]
//     A governed tool-call row for this harness landed in ACP's audit log
//     since <since>. Reads GET /admin/audit (same endpoint agentgovbench
//     uses); needs ACP_CANARY_KEY with the admin.audit.read scope.
//     ACP_TENANT_SLUG is required: production is multi-tenant and the
//     route is /<slug>/admin/audit (a bare /admin/audit is read as a slug).
//     On FAIL it prints every row seen in the window with its `decision`.
//
//   rows --harness <id> --since <iso Z>
//     One GET, then print every audit row in the window with its
//     `decision` (used by the opencode leg when the harness rejected the
//     call, so gsc#1380 can be classified: allow = plugin/opencode contract
//     drift, ask = the gateway is asking in audit mode). Never exits 1 on
//     an empty window; it is a dump, not an assertion.
//
// The audit API returns no argument preview, so the marker cannot be read
// back from the row. The match is: ts >= since, client string belongs to
// this harness, tool is a shell/echo call. Each canary job runs in a fresh
// runner against a dedicated canary workspace, so that window is specific.
// The marker still appears in the harness transcript (canary-run.log).

import fs from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const sub = args.shift();
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};

const HOME = os.homedir();
// Every leg id the workflow can pass. Harness legs get `invariants`; live
// harness legs and SDK legs get `audit` / `rows`.
export const HARNESSES = ["claude-code", "codex", "opencode", "qwen-code", "pi", "prime-agent", "grok", "dsh", "hermes", "openclaw", "muse"];
export const SDK_LEGS = ["sdk-governance-js", "sdk-governance-anthropic", "sdk-proxy", "sdk-governance-py", "sdk-langchain", "sdk-pydantic-ai", "sdk-crewai"];
const harness = opt("harness");
if (![...HARNESSES, ...SDK_LEGS].includes(harness)) {
  console.error(`usage: canary-assert.mjs <invariants|audit|rows> --harness <${[...HARNESSES, ...SDK_LEGS].join("|")}>`);
  process.exit(2);
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function governEntries(hooks, event) {
  const list = Array.isArray(hooks?.[event]) ? hooks[event] : [];
  return list.filter((e) => Array.isArray(e.hooks) && e.hooks.some((h) => typeof h.command === "string" && h.command.includes("govern.mjs")));
}
function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}
function readText(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}
function countLines(text, re) {
  return text.split("\n").filter((l) => re.test(l)).length;
}
// The agent directive the installer writes (acp:begin ... acp:end) must be
// in the file exactly once after any number of runs.
function directiveOnce(file) {
  const t = readText(path.join(HOME, file));
  const b = (t.match(/acp:begin/g) || []).length, e = (t.match(/acp:end/g) || []).length;
  check(b === 1 && e === 1, `~/${file} has the ACP directive exactly once (begin=${b}, end=${e})`);
}
function launcher(name) {
  check(isExecutable(path.join(HOME, ".acp", "bin", name)), `~/.acp/bin/${name} is executable`);
}
// Count every hook command string anywhere in a JSON document that runs
// govern.mjs (for harnesses whose hook file shape is theirs, not ours).
function governCommandsDeep(v, acc = []) {
  if (typeof v === "string") { if (v.includes("govern.mjs")) acc.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => governCommandsDeep(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => governCommandsDeep(x, acc));
  return acc;
}
function tryExec(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; }
}

function invariants() {
  check(fs.existsSync(path.join(HOME, ".acp", "govern.mjs")), "~/.acp/govern.mjs present");
  if (harness === "claude-code") {
    // install.sh prefers the ACP plugin (hooks live in the plugin's
    // hooks.json and any direct govern.mjs entries are removed) and falls
    // back to direct settings.json hooks on CLIs without plugin support.
    // Either way the hook must be wired exactly once, never twice.
    const s = readJson(path.join(HOME, ".claude", "settings.json"));
    check(s !== null, "~/.claude/settings.json parses");
    let pluginListed = false;
    try { pluginListed = execSync("claude plugin list", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes("agentic-control-plane"); } catch {}
    const pre = governEntries(s?.hooks, "PreToolUse").length;
    const post = governEntries(s?.hooks, "PostToolUse").length;
    if (pluginListed) {
      check(pre === 0 && post === 0, `ACP plugin installed and settings.json has no direct govern hook (pre=${pre}, post=${post})`);
    } else {
      check(pre === 1, `no plugin: settings.json PreToolUse has the govern hook exactly once (found ${pre})`);
      check(post === 1, `no plugin: settings.json PostToolUse has the govern hook exactly once (found ${post})`);
    }
    launcher("claude-acp");
    directiveOnce(".claude/CLAUDE.md");
  }
  if (harness === "codex") {
    let toml = "";
    try { toml = fs.readFileSync(path.join(HOME, ".codex", "config.toml"), "utf8"); } catch {}
    const blocks = toml.split("\n").filter((l) => /^\[model_providers\.acp\]\s*$/.test(l)).length;
    check(blocks === 1, `~/.codex/config.toml has [model_providers.acp] exactly once (found ${blocks})`);
    const h = readJson(path.join(HOME, ".codex", "hooks.json"));
    check(h !== null, "~/.codex/hooks.json parses");
    check(governEntries(h?.hooks, "PreToolUse").length === 1, "hooks.json PreToolUse has the govern hook exactly once");
    launcher("codex-acp");
    directiveOnce(".codex/AGENTS.md");
  }
  if (harness === "opencode") {
    const c = readJson(path.join(HOME, ".config", "opencode", "opencode.json"));
    check(c !== null, "~/.config/opencode/opencode.json parses");
    const n = Array.isArray(c?.plugin) ? c.plugin.filter((p) => p === "acp-opencode").length : 0;
    check(n === 1, `opencode.json plugin lists acp-opencode exactly once (found ${n})`);
    check(!!c?.provider?.acp, "opencode.json has the acp cost X-ray provider");
    launcher("opencode-acp");
    directiveOnce(".config/opencode/AGENTS.md");
  }
  if (harness === "qwen-code") {
    // Claude Code's hook contract read from ~/.qwen/settings.json.
    const s = readJson(path.join(HOME, ".qwen", "settings.json"));
    check(s !== null, "~/.qwen/settings.json parses");
    const pre = governEntries(s?.hooks, "PreToolUse").length;
    const post = governEntries(s?.hooks, "PostToolUse").length;
    check(pre === 1, `settings.json PreToolUse has the govern hook exactly once (found ${pre})`);
    check(post === 1, `settings.json PostToolUse has the govern hook exactly once (found ${post})`);
    check(s?.security?.auth?.selectedType === "openai", "settings.json kept the seeded openai auth type (qwen-acp prices only then)");
    launcher("qwen-acp");
    directiveOnce(".qwen/QWEN.md");
  }
  if (harness === "pi") {
    check(fs.existsSync(path.join(HOME, ".pi", "agent", "extensions", "acp.ts")), "~/.pi/agent/extensions/acp.ts present");
    const m = readJson(path.join(HOME, ".pi", "agent", "models.json"));
    check(!!m?.providers?.acp?.baseUrl && m.providers.acp.baseURL === undefined, "models.json has the acp provider (baseUrl, not baseURL)");
    check(!/gsk_/.test(readText(path.join(HOME, ".pi", "agent", "models.json"))), "models.json carries no key literal");
    launcher("pi-acp");
    directiveOnce(".pi/agent/AGENTS.md");
  }
  if (harness === "prime-agent") {
    check(fs.existsSync(path.join(HOME, ".prime", "agent", "extensions", "acp.ts")), "~/.prime/agent/extensions/acp.ts present");
    check(/ACP_PROXY/.test(readText(path.join(HOME, ".prime", "agent", "extensions", "acp-proxy.ts"))), "acp-proxy.ts present and gated on ACP_PROXY");
    launcher("prime-acp");
    directiveOnce(".prime/agent/AGENTS.md");
  }
  if (harness === "grok") {
    check(readJson(path.join(HOME, ".grok", "hooks", "acp.json")) !== null, "~/.grok/hooks/acp.json parses");
    const toml = readText(path.join(HOME, ".grok", "config.toml"));
    const blocks = countLines(toml, /^\[model\.acp\]\s*$/);
    check(blocks === 1, `~/.grok/config.toml has [model.acp] exactly once (found ${blocks})`);
    check(/env_key = "ACP_KEY"/.test(toml) && !/api_key/.test(toml), "config.toml reads the key from env_key, never api_key");
    launcher("grok-acp");
    directiveOnce(".grok/AGENTS.md");
  }
  if (harness === "dsh") {
    const y = readText(path.join(process.env.DSH_HOME || path.join(HOME, ".dsh"), "settings.yaml"));
    const n = (y.match(/api\.agenticcontrolplane\.com/g) || []).length;
    check(n === 1, `dsh settings.yaml has the acp provider exactly once (found ${n})`);
    check(/apiKeyEnv: ACP_BEARER_TOKEN/.test(y), "settings.yaml reads the key via apiKeyEnv");
    launcher("dsh-acp");
    directiveOnce(".dsh/AGENTS.md");
  }
  if (harness === "hermes") {
    // The plugin lives in hermes's own pip/pipx environment; the installer
    // enables it with `hermes plugins enable acp`.
    const plugins = tryExec("hermes plugins list");
    check(/acp/i.test(plugins), "`hermes plugins list` shows the acp plugin");
    launcher("hermes-acp");
    directiveOnce(".hermes/SOUL.md");
  }
  if (harness === "openclaw") {
    const s = readJson(path.join(HOME, ".openclaw", "settings.json"));
    check(s !== null, "~/.openclaw/settings.json parses");
    const n = governCommandsDeep(s).length;
    check(n >= 1 && n <= 2, `settings.json runs govern.mjs once per hook event, never duplicated (found ${n} command(s))`);
  }
  if (harness === "muse") {
    const plugins = tryExec("env MUSE_EXPERIMENTAL_PLUGINS=1 muse plugins list");
    check(/acp/i.test(plugins), "`muse plugins list` shows the acp plugin");
    directiveOnce(".config/muse/AGENTS.md");
  }
  // No config file the installer touches may ever carry the key literal
  // (explicit files, not a recursive grep: plugin caches and docs under
  // these dirs legitimately mention the gsk_ prefix).
  const configFiles = [".claude/settings.json", ".codex/config.toml", ".codex/hooks.json", ".config/opencode/opencode.json",
    ".qwen/settings.json", ".pi/agent/models.json", ".prime/agent/extensions/acp-proxy.ts", ".grok/config.toml", ".grok/hooks/acp.json",
    ".dsh/settings.yaml", ".openclaw/settings.json", ".hermes/config.yaml", ".hermes/config.toml", ".hermes/config.json"];
  const leaked = configFiles.filter((f) => /gsk_[A-Za-z0-9]{16,}/.test(readText(path.join(HOME, f))));
  check(leaked.length === 0, `no installer-written config file carries a key literal${leaked.length ? ` (${leaked.join(", ")})` : ""}`);
}

// Client strings the gateway records for each harness. The hooks send
// X-GS-Client as `<ACP_CLIENT>/<version>` (govern.mjs: claude-code-plugin/
// 0.26.0, codex/0.26.0; the opencode npm plugin: opencode-plugin/0.4.0), so
// match on the prefix, never on the whole string. The audit API returns
// `client` as an object ({ name, version }), not a string.
// Legs run concurrently against ONE canary workspace, so each live leg
// needs a client prefix no other leg produces. The SDK scripts set their
// own client header (`acp-canary-<leg>/<version>`) for exactly this reason.
const CLIENT_MATCH = {
  "claude-code": /^(claude-code|claude-cli)/,
  codex: /^codex/,
  opencode: /opencode/i,
  "qwen-code": /^qwen/i,
  pi: /^pi\b|^pi-|^acp-pi/i,
  "prime-agent": /^prime/i,
  grok: /^grok/i,
  dsh: /^dsh|deepseek/i,
  hermes: /^hermes/i,
  openclaw: /^openclaw/i,
  muse: /^muse/i,
};
for (const leg of SDK_LEGS) CLIENT_MATCH[leg] = new RegExp(`^acp-canary-${leg}`);
const TOOL_MATCH = /bash|shell|echo|exec/i;
const clientName = (e) => {
  const c = e?.client;
  if (typeof c === "string") return c;
  if (c && typeof c === "object") return String(c.name ?? c.id ?? "");
  return "";
};
const rowSummary = (e) => JSON.stringify({ ts: e.ts, client: clientName(e), tool: e.tool, toolRaw: e.toolRaw, decision: e.decision, outcome: e.outcome });

const MAX_ROWS_PRINTED = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function auditTarget() {
  const key = process.env.ACP_CANARY_KEY;
  if (!key) { console.error("ACP_CANARY_KEY is not set"); process.exit(2); }
  const base = (process.env.ACP_BASE_URL || "https://api.agenticcontrolplane.com").replace(/\/$/, "");
  const slug = process.env.ACP_TENANT_SLUG;
  if (!slug) { console.error("ACP_TENANT_SLUG is not set (the production gateway is multi-tenant: /<slug>/admin/audit)"); process.exit(2); }
  const since = opt("since");
  if (!since) { console.error("--since <iso> is required"); process.exit(2); }
  const url = new URL(`${base}/${slug}/admin/audit`);
  url.searchParams.set("since", since);
  url.searchParams.set("limit", "500");
  return { key, since, url };
}

// One GET of the window. Returns { status, entries } or { error }.
async function fetchWindow({ key, url }) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "X-GS-Client": `harness-canary/${harness}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`FAIL audit GET ${res.status}: the canary key needs the admin.audit.read scope`);
    process.exit(1);
  }
  if (!res.ok) return { status: res.status, error: (await res.text().catch(() => "")).slice(0, 200) };
  const body = await res.json().catch(() => ({}));
  return { status: res.status, entries: Array.isArray(body.entries) ? body.entries : [] };
}

function printRows(entries) {
  if (!entries.length) { console.log("  (no audit rows in the window)"); return; }
  for (const e of entries.slice(0, MAX_ROWS_PRINTED)) console.log(`  ${rowSummary(e)}`);
  if (entries.length > MAX_ROWS_PRINTED) console.log(`  ... ${entries.length - MAX_ROWS_PRINTED} more`);
}

async function audit() {
  const target = auditTarget();
  const { since } = target;
  const timeoutMs = Number(opt("timeout", "120")) * 1000;
  const marker = opt("marker", "");

  const deadline = Date.now() + timeoutMs;
  let lastSeen = { status: null, entries: [] };
  while (Date.now() < deadline) {
    const got = await fetchWindow(target);
    if (got.status) lastSeen.status = got.status;
    if (got.error !== undefined) {
      console.log(`audit GET ${got.status ?? "failed"}: ${got.error}; retrying`);
      await sleep(5000);
      continue;
    }
    lastSeen.entries = got.entries;
    const hit = got.entries.find((e) =>
      String(e.ts ?? "") >= since &&
      CLIENT_MATCH[harness].test(clientName(e)) &&
      (TOOL_MATCH.test(String(e.tool ?? "")) || TOOL_MATCH.test(String(e.toolRaw ?? ""))));
    if (hit) {
      console.log(`ok   audit row landed for ${harness}${marker ? ` (run ${marker})` : ""}:`);
      console.log(JSON.stringify({ id: hit.id, ts: hit.ts, tool: hit.tool, toolRaw: hit.toolRaw, client: hit.client, decision: hit.decision, outcome: hit.outcome, sessionId: hit.sessionId }, null, 2));
      if (hit.decision && !/allow/i.test(String(hit.decision))) {
        console.log(`note decision=${hit.decision}: the row landed, but the gateway did not pre-approve this call (gsc#1380: ask in audit mode)`);
      }
      return;
    }
    await sleep(5000);
  }
  const clients = new Set(), tools = new Set();
  for (const e of lastSeen.entries) { const c = clientName(e); if (c) clients.add(c); if (e.tool) tools.add(String(e.tool)); }
  console.error(`FAIL no audit row for ${harness} since ${since} within ${timeoutMs / 1000}s ` +
    `(last GET ${lastSeen.status}; ${lastSeen.entries.length} rows in window; clients=[${[...clients].join(", ")}]; tools=[${[...tools].slice(0, 10).join(", ")}])`);
  console.error("rows seen in the window (decision per row):");
  printRows(lastSeen.entries);
  process.exit(1);
}

async function rows() {
  const target = auditTarget();
  let got = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    got = await fetchWindow(target);
    if (got.error === undefined) break;
    console.log(`audit GET ${got.status ?? "failed"}: ${got.error}; retrying`);
    await sleep(3000);
  }
  if (!got || got.error !== undefined) { console.error("could not read the audit window"); process.exit(2); }
  console.log(`${got.entries.length} audit row(s) for ${harness} since ${target.since}:`);
  printRows(got.entries);
}

if (sub === "invariants") {
  invariants();
  if (failures.length) { console.error(`\n${failures.length} invariant(s) failed`); process.exit(1); }
} else if (sub === "audit") {
  await audit();
} else if (sub === "rows") {
  await rows();
} else {
  console.error("usage: canary-assert.mjs <invariants|audit|rows> ...");
  process.exit(2);
}
