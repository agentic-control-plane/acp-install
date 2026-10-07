#!/usr/bin/env node
// Harness canary assertions. Two subcommands:
//
//   invariants --harness <id>
//     The installer wrote exactly what it should for this harness, once.
//
//   audit --harness <id> --since <iso Z> [--marker <m>] [--timeout <s>]
//     A governed tool-call row for this harness landed in ACP's audit log
//     since <since>. Reads GET /admin/audit (same endpoint agentgovbench
//     uses); needs ACP_CANARY_KEY with the admin.audit.read scope.
//     ACP_TENANT_SLUG is required: production is multi-tenant and the
//     route is /<slug>/admin/audit (a bare /admin/audit is read as a slug).
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

// Client strings the gateway records for each harness (see
// install.sh ACP_CLIENT=... and the plugins). opencode's npm plugin owns
// its own string, so that one is matched loosely.
const CLIENT_MATCH = {
  "claude-code": /^claude-code-plugin$|^claude-cli$/,
  codex: /^codex(-mcp)?$/,
  opencode: /opencode/i,
};
const TOOL_MATCH = /bash|shell|echo|exec/i;

async function audit() {
  const key = process.env.ACP_CANARY_KEY;
  if (!key) { console.error("ACP_CANARY_KEY is not set"); process.exit(2); }
  const base = (process.env.ACP_BASE_URL || "https://api.agenticcontrolplane.com").replace(/\/$/, "");
  const slug = process.env.ACP_TENANT_SLUG;
  if (!slug) { console.error("ACP_TENANT_SLUG is not set (the production gateway is multi-tenant: /<slug>/admin/audit)"); process.exit(2); }
  const since = opt("since");
  if (!since) { console.error("--since <iso> is required"); process.exit(2); }
  const timeoutMs = Number(opt("timeout", "120")) * 1000;
  const marker = opt("marker", "");
  const url = new URL(`${base}/${slug}/admin/audit`);
  url.searchParams.set("since", since);
  url.searchParams.set("limit", "500");

  const deadline = Date.now() + timeoutMs;
  let lastSeen = { count: 0, clients: new Set(), tools: new Set(), status: null };
  while (Date.now() < deadline) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "X-GS-Client": `harness-canary/${harness}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      console.log(`audit GET failed: ${e?.message ?? e}; retrying`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    lastSeen.status = res.status;
    if (res.status === 401 || res.status === 403) {
      console.error(`FAIL audit GET ${res.status}: the canary key needs the admin.audit.read scope`);
      process.exit(1);
    }
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      const entries = Array.isArray(body.entries) ? body.entries : [];
      lastSeen.count = entries.length;
      for (const e of entries) { if (e.client) lastSeen.clients.add(String(e.client)); if (e.tool) lastSeen.tools.add(String(e.tool)); }
      const hit = entries.find((e) =>
        String(e.ts ?? "") >= since &&
        CLIENT_MATCH[harness].test(String(e.client ?? "")) &&
        (TOOL_MATCH.test(String(e.tool ?? "")) || TOOL_MATCH.test(String(e.toolRaw ?? ""))));
      if (hit) {
        console.log(`ok   audit row landed for ${harness}${marker ? ` (run ${marker})` : ""}:`);
        console.log(JSON.stringify({ id: hit.id, ts: hit.ts, tool: hit.tool, toolRaw: hit.toolRaw, client: hit.client, decision: hit.decision, outcome: hit.outcome, sessionId: hit.sessionId }, null, 2));
        return;
      }
    } else {
      console.log(`audit GET ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}; retrying`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error(`FAIL no audit row for ${harness} since ${since} within ${timeoutMs / 1000}s ` +
    `(last GET ${lastSeen.status}; ${lastSeen.count} rows in window; clients=[${[...lastSeen.clients].join(", ")}]; tools=[${[...lastSeen.tools].slice(0, 10).join(", ")}])`);
  process.exit(1);
}

if (sub === "invariants") {
  invariants();
  if (failures.length) { console.error(`\n${failures.length} invariant(s) failed`); process.exit(1); }
} else if (sub === "audit") {
  await audit();
} else {
  console.error("usage: canary-assert.mjs <invariants|audit> ...");
  process.exit(2);
}
