#!/usr/bin/env node
// Harness canary assertions. Three subcommands:
//
//   invariants --harness <id>
//     The installer wrote exactly what it should for this harness, once.
//     This is the whole canary for claude-code and codex (no live call).
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
const harness = opt("harness");
if (!["claude-code", "codex", "opencode"].includes(harness)) {
  console.error(`usage: canary-assert.mjs <invariants|audit> --harness <claude-code|codex|opencode>`);
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
    check(isExecutable(path.join(HOME, ".acp", "bin", "claude-acp")), "~/.acp/bin/claude-acp is executable");
  }
  if (harness === "codex") {
    let toml = "";
    try { toml = fs.readFileSync(path.join(HOME, ".codex", "config.toml"), "utf8"); } catch {}
    const blocks = toml.split("\n").filter((l) => /^\[model_providers\.acp\]\s*$/.test(l)).length;
    check(blocks === 1, `~/.codex/config.toml has [model_providers.acp] exactly once (found ${blocks})`);
    const h = readJson(path.join(HOME, ".codex", "hooks.json"));
    check(h !== null, "~/.codex/hooks.json parses");
    check(governEntries(h?.hooks, "PreToolUse").length === 1, "hooks.json PreToolUse has the govern hook exactly once");
    check(isExecutable(path.join(HOME, ".acp", "bin", "codex-acp")), "~/.acp/bin/codex-acp is executable");
  }
  if (harness === "opencode") {
    const c = readJson(path.join(HOME, ".config", "opencode", "opencode.json"));
    check(c !== null, "~/.config/opencode/opencode.json parses");
    const n = Array.isArray(c?.plugin) ? c.plugin.filter((p) => p === "acp-opencode").length : 0;
    check(n === 1, `opencode.json plugin lists acp-opencode exactly once (found ${n})`);
    check(!!c?.provider?.acp, "opencode.json has the acp cost X-ray provider");
    check(isExecutable(path.join(HOME, ".acp", "bin", "opencode-acp")), "~/.acp/bin/opencode-acp is executable");
  }
}

// Client strings the gateway records for each harness. The hooks send
// X-GS-Client as `<ACP_CLIENT>/<version>` (govern.mjs: claude-code-plugin/
// 0.26.0, codex/0.26.0; the opencode npm plugin: opencode-plugin/0.4.0), so
// match on the prefix, never on the whole string. The audit API returns
// `client` as an object ({ name, version }), not a string.
const CLIENT_MATCH = {
  "claude-code": /^(claude-code|claude-cli)/,
  codex: /^codex/,
  opencode: /opencode/i,
};
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
