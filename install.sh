#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────
# Agentic Control Plane — Universal Installer
#
# Source:    https://github.com/agentic-control-plane/acp-install
# License:   MIT
# Docs:      https://agenticcontrolplane.com
# Support:   https://github.com/agentic-control-plane/acp-install/issues
#
# What this script will do on your machine:
#
#   1. Detect which AI clients are installed
#        Claude Code · Cursor · OpenAI Codex CLI · OpenClaw
#
#   2. Write ~/.acp/govern.mjs (the hook dispatcher script — shared across clients)
#
#   3. Register PreToolUse + PostToolUse hooks in each detected client's config:
#        ~/.claude/settings.json      (Claude Code)
#        ~/.cursor/hooks.json         (Cursor)
#        ~/.codex/hooks.json          (Codex CLI)
#
#   4. For Codex specifically:
#        - Enable [features].codex_hooks = true in ~/.codex/config.toml
#        - Add [mcp_servers.acp] block so non-Bash tools flow through the
#          ACP MCP connector
#        - Write ~/.codex/AGENTS.md section instructing Codex to call
#          `acp_check` before non-Bash tool calls (instruction-layer
#          governance for tools Codex hooks don't yet cover)
#
#   5. Open your browser to authenticate and provision an ACP workspace
#
#   6. Save the API key to ~/.acp/credentials (chmod 600)
#
# Usage:
#   curl -sf https://agenticcontrolplane.com/install.sh | bash
#
# Review the source before running:
#   curl -sf https://agenticcontrolplane.com/install.sh | less
#   github.com/agentic-control-plane/acp-install (mirror)
#
# ─────────────────────────────────────────────────────────────────────

API_BASE="${ACP_API_BASE:-https://api.agenticcontrolplane.com}"
DASHBOARD_BASE="${ACP_DASHBOARD_BASE:-https://cloud.agenticcontrolplane.com}"
CONFIG_DIR="$HOME/.acp"
CREDS_FILE="$CONFIG_DIR/credentials"

# ── Local mode: no account, no cloud, nothing leaves your machine ──────
# Enable with:  curl -sf …/install.sh | bash -s -- --local   (or ACP_LOCAL=1)
LOCAL_MODE=false
for _a in "$@"; do case "$_a" in --local|--no-login) LOCAL_MODE=true ;; esac; done
[ "${ACP_LOCAL:-}" = "1" ] && LOCAL_MODE=true

# ── Terminal colors ───────────────────────────────────────────────────
# tput-guarded: green success / red failure / dim secondary, mirroring
# the console's ALLOW/DENY language. Degrades to plain text when stdout
# is not a TTY or the terminal has no color support.
if [ -t 1 ] && command -v tput &> /dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_GREEN="$(tput setaf 2)"
  C_RED="$(tput setaf 1)"
  C_DIM="$(tput dim)"
  C_RESET="$(tput sgr0)"
else
  C_GREEN=""
  C_RED=""
  C_DIM=""
  C_RESET=""
fi

# ── Detect available clients ──────────────────────────────────────────

HAS_CLAUDE=false
HAS_CURSOR=false
HAS_CODEX=false
HAS_OPENCLAW=false
HAS_OPENCODE=false
INSTALLED=""

if [ -d "$HOME/.claude" ] || command -v claude &> /dev/null; then
  HAS_CLAUDE=true
fi

if [ -d "$HOME/.cursor" ] || command -v cursor &> /dev/null; then
  HAS_CURSOR=true
fi

if [ -d "$HOME/.codex" ] || command -v codex &> /dev/null; then
  HAS_CODEX=true
fi

if command -v openclaw &> /dev/null; then
  HAS_OPENCLAW=true
fi

# Hermes Agent — governed via its native pip plugin. One front door: this
# installer performs the plugin install itself (David 2026-07-21: fold every
# harness into the one-liner). Fail-open: any step failing degrades to
# printing the manual commands, never a broken half-install.
HAS_HERMES=false
if command -v hermes &> /dev/null; then
  HAS_HERMES=true
fi
# Cloud-only: hermes-acp governs via a workspace token (without one it passes
# through), so --local skips the plugin install rather than wiring a no-op.
if [ "$HAS_HERMES" = true ] && [ "$LOCAL_MODE" = true ]; then
  echo "  ${C_DIM}Hermes detected — skipped in --local mode (its ACP plugin needs a workspace; local decisions aren't wired there yet).${C_RESET}"
  echo ""
fi
if [ "$HAS_HERMES" = true ] && [ "$LOCAL_MODE" = false ]; then
  echo "  Detected Hermes Agent — installing the ACP plugin…"
  HERMES_PLUGIN_OK=false
  # If hermes lives in a pipx venv, the plugin must be injected there —
  # a bare pip install lands in the wrong environment.
  if command -v pipx &> /dev/null && pipx list 2>/dev/null | grep -qi "package hermes"; then
    pipx inject hermes hermes-acp --force >/dev/null 2>&1 && HERMES_PLUGIN_OK=true
  fi
  # Otherwise install with the same interpreter that runs hermes (shebang),
  # falling back to plain pip. PEP 668 boxes will refuse — that's the
  # fail-open path below, not something to --break-system-packages through.
  if [ "$HERMES_PLUGIN_OK" = false ]; then
    HERMES_BIN="$(command -v hermes)"
    HERMES_PY="$(head -1 "$HERMES_BIN" 2>/dev/null | sed -n 's/^#!//p')"
    if [ -n "$HERMES_PY" ] && [ -x "$HERMES_PY" ]; then
      "$HERMES_PY" -m pip install --upgrade hermes-acp >/dev/null 2>&1 && HERMES_PLUGIN_OK=true
    fi
  fi
  if [ "$HERMES_PLUGIN_OK" = false ]; then
    pip install --upgrade hermes-acp >/dev/null 2>&1 && HERMES_PLUGIN_OK=true
  fi
  if [ "$HERMES_PLUGIN_OK" = true ] && hermes plugins enable acp >/dev/null 2>&1; then
    echo "  ${C_GREEN}✓ Hermes governed${C_RESET} — next: acp-hermes login   (headless box: set ACP_BEARER_TOKEN instead)"
  else
    echo "  Couldn't install automatically (often a PEP 668 managed environment)."
    echo "  Run it in your Python env of choice:"
    echo "    pip install hermes-acp && hermes plugins enable acp && acp-hermes login"
    echo "  Guide: https://agenticcontrolplane.com/integrations/hermes"
  fi
  echo ""
fi

# opencode (sst/opencode) — global config/plugins live under ~/.config/opencode.
if [ -d "$HOME/.config/opencode" ] || command -v opencode &> /dev/null; then
  HAS_OPENCODE=true
fi

if [ "$HAS_CLAUDE" = false ] && [ "$HAS_CURSOR" = false ] && [ "$HAS_CODEX" = false ] && [ "$HAS_OPENCLAW" = false ] && [ "$HAS_OPENCODE" = false ]; then
  # Hermes-only box: the plugin path above already handled it — success, not
  # "nothing detected".
  if [ "$HAS_HERMES" = true ]; then
    if [ "$LOCAL_MODE" = true ]; then
      echo "  Hermes was the only client found — local mode doesn't govern Hermes yet; re-run without --local."
    else
      echo "  Hermes was the only client found — you're done here."
    fi
    exit 0
  fi
  echo "  ${C_RED}No supported AI clients detected.${C_RESET}"
  echo "  Supported: Claude Code, Cursor, OpenAI Codex CLI, OpenClaw, opencode"
  echo "  Hermes Agent? It has a native pip plugin instead:"
  echo "    pip install hermes-acp && hermes plugins enable acp && acp-hermes login"
  echo "  Guide: https://agenticcontrolplane.com/integrations/hermes"
  echo ""
  echo "  Install one first, then re-run this script."
  exit 1
fi

TARGETS=""
if [ "$HAS_CLAUDE" = true ]; then TARGETS="Claude Code"; fi
if [ "$HAS_CURSOR" = true ]; then
  if [ -n "$TARGETS" ]; then TARGETS="$TARGETS + Cursor"; else TARGETS="Cursor"; fi
fi
if [ "$HAS_CODEX" = true ]; then
  if [ -n "$TARGETS" ]; then TARGETS="$TARGETS + Codex"; else TARGETS="Codex"; fi
fi
if [ "$HAS_OPENCLAW" = true ]; then
  if [ -n "$TARGETS" ]; then TARGETS="$TARGETS + OpenClaw"; else TARGETS="OpenClaw"; fi
fi
if [ "$HAS_OPENCODE" = true ]; then
  if [ -n "$TARGETS" ]; then TARGETS="$TARGETS + opencode"; else TARGETS="opencode"; fi
fi

echo ""
echo "  Agentic Control Plane"
echo "  Identity & governance for $TARGETS"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

mkdir -p "$CONFIG_DIR"

# ── Shared: write govern.mjs ──────────────────────────────────────────
# Single dispatcher script used by non-plugin clients (Cursor, Codex,
# opencode) and as the Claude Code fallback. The CANONICAL copy lives in
# the plugin repo (bin/govern.mjs — scoped-token exchange + the govern.*
# control-plane endpoint); fetch it so hook fixes reach these harnesses
# without an installer release. The inline copy below is the offline
# fallback only.

echo "  [ACP] Installing governance hook script..."
GOVERN_RAW_URL="https://raw.githubusercontent.com/agentic-control-plane/claude-code-acp-plugin/main/bin/govern.mjs"
# In --local mode the fetched copy must actually carry the local decision
# path (runLocal). A canonical copy without it would exit silently on every
# call — "local mode active" with zero governance and zero audit. Never
# brick, never silently: such a copy is rejected in favor of the bundled one.
if curl -sf --max-time 10 "$GOVERN_RAW_URL" -o "$CONFIG_DIR/govern.mjs.tmp" 2>/dev/null \
   && head -1 "$CONFIG_DIR/govern.mjs.tmp" | grep -q "node" \
   && { [ "$LOCAL_MODE" = false ] || grep -q "runLocal" "$CONFIG_DIR/govern.mjs.tmp"; }; then
  mv "$CONFIG_DIR/govern.mjs.tmp" "$CONFIG_DIR/govern.mjs"
  GOVERN_SOURCE="canonical (plugin repo)"
else
  rm -f "$CONFIG_DIR/govern.mjs.tmp"
  GOVERN_SOURCE="bundled fallback"
  cat > "$CONFIG_DIR/govern.mjs" << 'GOVERN'
#!/usr/bin/env node
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ACP_API = process.env.ACP_API_BASE || "https://api.agenticcontrolplane.com";
const PLUGIN_VERSION = "0.4.0";
// Identifies the calling client to the server (per-client policy routing).
// Each client's hooks.json sets this env var at invocation time: "claude-code-plugin",
// "cursor", "codex", etc. Falls back to claude-code-plugin for backward compat.
const ACP_CLIENT = process.env.ACP_CLIENT || "claude-code-plugin";
const POST_HOOK_PAYLOAD_CEILING = 200 * 1024;

function readToken() {
  if (process.env.ACP_BEARER_TOKEN) return process.env.ACP_BEARER_TOKEN;
  // Both credential paths, in the same order as the plugin's
  // bin/mcp-auth-headers.sh — these MUST stay in sync. When only proxy-key
  // exists, MCP authenticates (the install looks healthy) while a
  // credentials-only hook reads nothing and no-ops (#596).
  for (const name of ["credentials", "proxy-key"]) {
    try {
      const value = readFileSync(join(homedir(), ".acp", name), "utf8").trim();
      if (value) return value;
    } catch { /* absent or unreadable — try the next path */ }
  }
  return null;
}

const ACP_DIR = join(homedir(), ".acp");
const token = readToken();
// LOCAL mode: no account, no cloud. Active when there's no token AND either a
// local policy exists or ACP_LOCAL=1. Decisions are made on-device by
// decide.mjs against ~/.acp/policy.json; calls are logged to ~/.acp/audit.jsonl.
const LOCAL = !token && (process.env.ACP_LOCAL === "1" || existsSync(join(ACP_DIR, "policy.json")));

// Read stdin via async iteration, not readFileSync("/dev/stdin"): on Linux a
// non-blocking pipe makes the sync read throw EAGAIN, which would silently
// skip governance for every call. (Caught by CI on ubuntu.) Read before the
// no-credentials check so the warning can name the session and the tool.
let input;
try {
  process.stdin.setEncoding("utf8");
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  input = JSON.parse(raw);
} catch { process.exit(0); }

// Wired but uncredentialed: never brick — but NEVER silently (#592). The
// canonical bin/govern.mjs warns loudly here; this offline fallback must
// match, or the no-network install path keeps the exact silent-ungoverned
// hole the front-door fix closed. Banner once per session (marker-deduped);
// a lapse.log line every call — the durable, auditable record of the gap.
if (!token && !LOCAL) {
  const sessionId = String(input?.session_id ?? "unknown");
  try { mkdirSync(ACP_DIR, { recursive: true }); } catch { /* best-effort */ }
  try {
    appendFileSync(join(ACP_DIR, "lapse.log"),
      `${new Date().toISOString()}\tUNGOVERNED\tno-credentials\tclient=${ACP_CLIENT}\tsession=${sessionId}\ttool=${input?.tool_name ?? "?"}\n`);
  } catch { /* the lapse log is best-effort — never block a call on it */ }
  let seen = false;
  try { seen = readFileSync(join(ACP_DIR, "nocred-session"), "utf8").trim() === sessionId; } catch {}
  if (!seen) {
    try { writeFileSync(join(ACP_DIR, "nocred-session"), sessionId); } catch { /* at worst the banner repeats */ }
    process.stdout.write(JSON.stringify({
      systemMessage:
        "[ACP] ⚠ UNGOVERNED: no API key found at ~/.acp/credentials — tool calls are running WITHOUT policy checks, and ACP has no record of them. " +
        "Get your key at https://cloud.agenticcontrolplane.com, then: echo 'YOUR_API_KEY' > ~/.acp/credentials — and restart this session.",
    }));
  }
  process.exit(0);
}

if (LOCAL) { await runLocal(input); process.exit(0); }

async function runLocal(input) {
  const audit = (obj) => { try { appendFileSync(join(ACP_DIR, "audit.jsonl"), JSON.stringify(obj) + "\n"); } catch {} };
  const ev = typeof input.hook_event_name === "string" ? input.hook_event_name : "PreToolUse";
  if (ev === "PostToolUse") {
    audit({ ts: new Date().toISOString(), event: "post", client: ACP_CLIENT, tool: input.tool_name });
    return;
  }
  let policy = { default: "allow", rules: {} };
  try { policy = JSON.parse(readFileSync(join(ACP_DIR, "policy.json"), "utf8")); } catch {}
  let decide;
  try { ({ decide } = await import("./decide.mjs")); }
  catch {
    // Engine missing/corrupt → never brick, but NEVER silently: say it loud
    // and leave an audit line, same contract as the cloud path's fail-open.
    audit({ ts: new Date().toISOString(), event: "pre", client: ACP_CLIENT, tool: input.tool_name,
            decision: "allow", source: "fail-open", reason: "local engine unavailable (~/.acp/decide.mjs)" });
    process.stdout.write(JSON.stringify({
      systemMessage: "[ACP·local] ⚠ decision engine unavailable (~/.acp/decide.mjs) — this call ran UNGOVERNED and was allowed. Re-run the installer to restore it.",
    }));
    return;
  }
  const d = decide(input.tool_name, input.tool_input, policy);
  audit({ ts: new Date().toISOString(), event: "pre", client: ACP_CLIENT, tool: input.tool_name,
          classified: d.classified, decision: d.decision, source: d.source, reason: d.reason });
  if (d.decision === "deny") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `[ACP] ${d.reason}` },
      systemMessage: `[ACP·local] Blocked: ${d.reason}`,
    }));
  } else if (d.decision === "ask") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `[ACP] ${d.reason}` },
    }));
  }
  // allow → no output (silent allow, still logged to audit.jsonl)
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GS-Client": `${ACP_CLIENT}/${PLUGIN_VERSION}`,
};

function resolveAgentTier() {
  const mode = input.permission_mode;
  if (mode === "auto") return "subagent";
  if (mode === "bypassPermissions") return "background";
  return "interactive";
}

async function handlePreToolUse() {
  const body = JSON.stringify({
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    session_id: input.session_id,
    cwd: input.cwd,
    hook_event_name: "PreToolUse",
    agent_tier: resolveAgentTier(),
    permission_mode: input.permission_mode,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  function deny(reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `[ACP] ${reason}`,
      },
      systemMessage: `[ACP] Blocked: ${reason}`,
    }));
    process.exit(0);
  }
  // Fail mode when ACP is unreachable — a policy DENY always blocks; this
  // only governs infrastructure failures. POLICY (2026-07-13): everything
  // fails OPEN by default — like starting in audit mode, we never brick an
  // agent the user didn't explicitly choose to have brick. Every fail-open
  // call carries a loud "this ran UNGOVERNED" message. Opt in to blocking:
  //   echo closed > ~/.acp/failmode     (or set ACP_FAIL_MODE=closed)
  function readFailMode() {
    const env = (process.env.ACP_FAIL_MODE || "").trim().toLowerCase();
    if (env === "open" || env === "closed") return env;
    try {
      const v = require("fs").readFileSync(require("os").homedir() + "/.acp/failmode", "utf8").trim().toLowerCase();
      if (v === "open" || v === "closed") return v;
    } catch {}
    return "open";
  }
  function unreachable(detail) {
    if (readFailMode() === "closed") { deny(`ACP unreachable — tool call blocked (fail-closed). ${detail}`); return; }
    process.stdout.write(JSON.stringify({
      systemMessage: `[ACP] ⚠ gateway unreachable (${detail}) — this call was ALLOWED but ran UNGOVERNED and was not logged. Fail-open is ACP's default for every agent (we never brick you without your say-so); to block instead: echo closed > ~/.acp/failmode`,
    }));
    process.exit(0);
  }
  try {
    const res = await fetch(`${ACP_API}/govern/tool-use`, { method: "POST", headers, body, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) { unreachable("HTTP " + res.status); return; }
    const data = await res.json();
    if (data.decision === "deny") deny(data.reason || "denied by policy");
    // Grace-zone billing warning: allowed call, loud message on every one.
    if (data.warning) {
      process.stdout.write(JSON.stringify({ systemMessage: `⚠ ${data.warning}` }));
    }
  } catch {
    unreachable("no response within 4s");
  } finally { clearTimeout(timeout); }
  process.exit(0);
}

async function handlePostToolUse() {
  let outputStr = "";
  try {
    const out = input.tool_response ?? input.tool_output ?? input.output;
    if (typeof out === "string") outputStr = out;
    else if (out !== undefined && out !== null) outputStr = JSON.stringify(out);
  } catch { process.exit(0); }
  if (Buffer.byteLength(outputStr, "utf8") > POST_HOOK_PAYLOAD_CEILING) {
    outputStr = outputStr.slice(0, POST_HOOK_PAYLOAD_CEILING);
  }
  const body = JSON.stringify({
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    tool_output: outputStr,
    session_id: input.session_id,
    cwd: input.cwd,
    hook_event_name: "PostToolUse",
    agent_tier: resolveAgentTier(),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${ACP_API}/govern/tool-output`, { method: "POST", headers, body, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) { process.exit(0); }
    const data = await res.json();
    if (data.action === "redact" || data.action === "block") {
      process.stdout.write(JSON.stringify({
        systemMessage: `[ACP] ${data.action === "block" ? "Blocked" : "Flagged"}: ${data.reason || "governance policy"}`,
      }));
    }
  } catch {
    // silent pass-through
  } finally { clearTimeout(timeout); }
  process.exit(0);
}

const hookEvent = typeof input.hook_event_name === "string" ? input.hook_event_name : "PreToolUse";
if (hookEvent === "PostToolUse") handlePostToolUse();
else handlePreToolUse();
GOVERN
fi
chmod +x "$CONFIG_DIR/govern.mjs"
echo "  ${C_GREEN}✓${C_RESET} [ACP] Governance hook installed ($GOVERN_SOURCE)"

# ── Shared: write decide.mjs (LOCAL decision engine — no cloud, no login) ──
# Mirrors decide.mjs in the repo verbatim. Pure, self-contained; govern.mjs
# imports it only in LOCAL mode.
cat > "$CONFIG_DIR/decide.mjs" << 'DECIDE'
// decide.mjs — LOCAL decision engine for Agentic Control Plane.
//
// Runs entirely on your machine. No account, no network, no phone-home: it
// classifies a tool call, applies a safety floor, and consults your local
// policy file (~/.acp/policy.json). This is the same *shape* of decision the
// hosted gateway makes — the hosted product adds the tuned risk classifier,
// cross-instance limits, team policy sync, cost X-ray, and the console.
//
// This module is intentionally pure and self-contained (no imports, no I/O) so
// it is trivial to review, run offline, and later publish as the open decision
// primitive. The dispatcher (govern.mjs) supplies the policy object and writes
// the audit line; this file only decides.
//
// It is mirrored verbatim into install.sh (~/.acp/decide.mjs at install time);
// test/mirror.test.mjs fails CI if the two ever diverge.

/** Split a command into argv-ish tokens, honoring quotes and stopping at the
 *  first shell control operator (| ; &). Env-assignments and wrappers are kept
 *  as tokens; callers strip them. */
function shellTokens(cmd) {
  const out = [];
  let buf = "";
  let quote = null;
  for (const ch of String(cmd)) {
    if (quote) { if (ch === quote) quote = null; else buf += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === " " || ch === "\t" || ch === "\n") { if (buf) { out.push(buf); buf = ""; } continue; }
    if (ch === "|" || ch === ";" || ch === "&") { if (buf) { out.push(buf); buf = ""; } break; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

const WRAPPERS = new Set(["sudo", "env", "nice", "nohup", "stdbuf", "timeout", "time", "xargs", "command", "doas"]);

/** Split a command line into its piped/chained segments (on unquoted | & ; and
 *  newlines), so the floor inspects every command in a compound line, not just
 *  the first (e.g. `echo hi && rm -rf ~`). */
function splitSegments(cmd) {
  const segs = [];
  let buf = "";
  let quote = null;
  for (const ch of String(cmd)) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "|" || ch === "&" || ch === ";" || ch === "\n") { if (buf.trim()) segs.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) segs.push(buf.trim());
  return segs;
}

/** Strip leading env-assignments and benign wrappers; return { bin, args } where
 *  bin is the canonical binary (basename, no path) and args are its arguments. */
function parseCommand(cmd) {
  const toks = shellTokens(cmd);
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t.includes("=") && !t.startsWith("-")) { i++; continue; }        // FOO=bar
    if (WRAPPERS.has(t)) { i++; while (i < toks.length && toks[i].startsWith("-")) i++; continue; }
    return { bin: t.split("/").pop(), args: toks.slice(i + 1) };
  }
  return { bin: "", args: [] };
}

/** Canonical binary of a shell command (basename), skipping env + wrappers. */
function canonicalBinary(cmd) {
  return parseCommand(cmd).bin;
}

/** First http(s) host in a command (for curl/wget), else undefined. */
function firstHost(cmd) {
  const m = String(cmd).match(/https?:\/\/([^/\s"']+)/i);
  if (!m) return undefined;
  return m[1].replace(/^www\./, "").toLowerCase();
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// Shell subcommands worth policy granularity: `git push` should be governable
// without also governing `git status`. Keep this small and obvious.
const SUBCOMMAND_BINS = new Set(["git", "gh", "docker", "kubectl", "npm", "pnpm", "yarn", "pip", "pip3", "gcloud", "aws", "systemctl"]);

/** First non-flag argument (the subcommand), lowercased, or undefined. */
function firstSubcommand(args) {
  for (const a of args) { if (!a.startsWith("-")) return a.toLowerCase(); }
  return undefined;
}

/**
 * Classify a tool call into a dotted policy key, e.g. "Bash.rm",
 * "Bash.git.push", "Bash.curl.api.github.com", "Write", "WebFetch.example.com".
 */
export function classifyTool(toolName, toolInput) {
  const name = String(toolName || "");
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});

  if (name === "Bash" || name === "run_terminal_cmd" || name === "shell") {
    const cmd = input.command || input.cmd || "";
    const { bin, args } = parseCommand(cmd);
    if (!bin) return "Bash";
    if (bin === "curl" || bin === "wget") {
      const host = firstHost(cmd);
      return host ? `Bash.curl.${host}` : "Bash.curl";
    }
    if (SUBCOMMAND_BINS.has(bin)) {
      const sub = firstSubcommand(args);
      return sub ? `Bash.${bin}.${sub}` : `Bash.${bin}`;
    }
    return `Bash.${bin}`;
  }
  if (name === "Write" || name === "Edit" || name === "MultiEdit" || name === "create_file" || name === "edit_file") {
    return "Write";
  }
  if (name === "Read" || name === "read_file" || name === "Glob" || name === "Grep" || name === "LS") {
    return "Read";
  }
  if (name === "WebFetch" || name === "WebSearch" || name === "web_search") {
    const host = firstHost(input.url || "");
    return host ? `WebFetch.${host}` : "WebFetch";
  }
  return name;
}

// ── Safety floor ──────────────────────────────────────────────────────
// Obvious, catastrophic, hard-to-undo actions denied regardless of policy.
// Deliberately conservative and OBVIOUS (not secret heuristics — the tuned
// detector lives in the hosted product). The bar: "no legitimate agent task
// ever needs this." Token-based where flag order/spelling varies, so the
// common phrasings can't slip past (rm -rf ~/ , rm -r -f / , git push -f , …).

/** Does this arg list carry short flag `letter` (e.g. -rf, -f) or `--long`? */
function hasShortOrLongFlag(args, letter, longName) {
  for (const a of args) {
    if (a === `--${longName}`) return true;
    if (/^-[a-z]+$/i.test(a) && a.slice(1).toLowerCase().includes(letter)) return true;
  }
  return false;
}

const RM_DANGER_TARGETS = new Set(["/", "~", "~/", "$HOME", "$HOME/", "${HOME}", ".", "./", "*", "/*", "./*", "~/*"]);

/** rm with BOTH recursive and force, aimed at a root/home/cwd/glob target. */
function rmForceFloor(bin, args) {
  if (bin !== "rm") return null;
  const recursive = hasShortOrLongFlag(args, "r", "recursive");
  const force = hasShortOrLongFlag(args, "f", "force");
  if (!recursive || !force) return null;
  const targets = args.filter((a) => !a.startsWith("-"));
  for (const t of targets) {
    const norm = t.replace(/\/+$/, ""); // trailing slash → same target (~/ ≡ ~)
    if (RM_DANGER_TARGETS.has(t) || RM_DANGER_TARGETS.has(norm) || norm === "") {
      return "recursive force-delete of a root/home path";
    }
  }
  return null;
}

/** git push that force-updates main/master (any flag order, -f or --force, or
 *  a +refspec). */
function gitForcePushFloor(bin, args) {
  if (bin !== "git") return null;
  if (firstSubcommand(args) !== "push") return null;
  const targetsMain = args.some((a) => /(^|[:+/])(main|master)$/.test(a));
  if (!targetsMain) return null;
  const forceFlag = hasShortOrLongFlag(args, "f", "force") || args.includes("--force-with-lease");
  const plusRefspec = args.some((a) => /^\+/.test(a) && /(main|master)/.test(a));
  if (forceFlag || plusRefspec) return "force-push to main/master";
  return null;
}

// Shells whose `-c <string>` argument is itself a command line: recurse the
// floor into it so `bash -c "rm -rf ~"` can't launder past token inspection.
const SHELL_BINS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** If this command hands a string to another interpreter (`bash -c '…'`,
 *  `eval …`), return that inner command line; else undefined. */
function innerShellCommand(bin, args) {
  if (SHELL_BINS.has(bin)) {
    for (let i = 0; i < args.length; i++) {
      if (/^-[a-z]*c[a-z]*$/i.test(args[i])) return args[i + 1];
    }
    return undefined;
  }
  if (bin === "eval") return args.join(" ");
  return undefined;
}

/** Token floors, per segment, recursing one level into shell -c / eval. */
function tokenFloorScan(cmd, depth = 0) {
  if (depth > 3) return null;
  for (const seg of splitSegments(cmd)) {
    const { bin, args } = parseCommand(seg);
    const hit = rmForceFloor(bin, args) || gitForcePushFloor(bin, args);
    if (hit) return hit;
    const inner = innerShellCommand(bin, args);
    if (inner) {
      const h = tokenFloorScan(inner, depth + 1);
      if (h) return h;
    }
  }
  return null;
}

const REGEX_RULES = [
  [/\bmkfs\.[a-z0-9]+\b|\bmkfs\s/i, "filesystem format (mkfs)"],
  [/\bdd\b[^|;&]*\bof=\/dev\/(sd|nvme|disk|hd)/i, "raw disk overwrite (dd of=/dev/…)"],
  [/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb"],
  [/\bchmod\s+-R\s+0*777\s+\/(\s|$)/i, "recursive chmod 777 on /"],
  [/>\s*\/dev\/(sd|nvme|disk|hd)[a-z0-9]*/i, "redirect over a raw disk device"],
];

/**
 * The safety floor: obvious, catastrophic commands denied regardless of policy.
 * Returns a deny reason, or null.
 */
export function hardlineFloor(toolName, toolInput) {
  const name = String(toolName || "");
  if (name !== "Bash" && name !== "run_terminal_cmd" && name !== "shell") return null;
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});
  const cmd = String(input.command || input.cmd || "");

  // Token floors run per-segment so a catastrophe hidden after `&&`/`;`/`|`
  // (e.g. `echo ok && rm -rf ~`) is still caught, and recurse into
  // `bash -c "…"` / `eval …` so hand-off to another shell can't launder it.
  const tokenFloor = tokenFloorScan(cmd);
  if (tokenFloor) return tokenFloor;

  const c = cmd.replace(/\s+/g, " ").trim();
  for (const [re, why] of REGEX_RULES) if (re.test(c)) return why;
  return null;
}

/**
 * Walk a dotted key from most-specific to least, e.g.
 * "Bash.curl.api.github.com" → [..., "Bash.curl", "Bash"].
 */
export function candidates(key) {
  const parts = String(key).split(".");
  const out = [];
  for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).join("."));
  return out;
}

const VALID = new Set(["allow", "ask", "deny"]);

/**
 * Decide a tool call locally.
 * @param policy { default: "allow"|"ask"|"deny", rules: { [key]: "allow"|"ask"|"deny" } }
 * @returns { decision, reason, source, classified }
 */
export function decide(toolName, toolInput, policy) {
  const floor = hardlineFloor(toolName, toolInput);
  if (floor) return { decision: "deny", reason: floor, source: "hardline", classified: classifyTool(toolName, toolInput) };

  const key = classifyTool(toolName, toolInput);
  const rules = (policy && policy.rules) || {};
  for (const cand of candidates(key)) {
    const r = rules[cand];
    if (VALID.has(r)) {
      return { decision: r, reason: `local policy: ${cand} → ${r}`, source: "policy", classified: key };
    }
  }
  const def = VALID.has(policy && policy.default) ? policy.default : "allow";
  return { decision: def, reason: `local policy: default → ${def}`, source: "default", classified: key };
}
DECIDE
chmod +x "$CONFIG_DIR/decide.mjs"

# ── Step 1a: Claude Code setup ────────────────────────────────────────

if [ "$HAS_CLAUDE" = true ]; then
  echo "  [Claude Code] Setting up governance..."

  # ── Preferred path (#295): install the PLUGIN. It carries the hooks,
  #    the /cost-xray + /acp skills, AND the bundled ACP MCP server, with
  #    marketplace version tracking — users actually receive updates.
  #    Falls back to direct hook wiring on older Claude Code CLIs.
  CLAUDE_PLUGIN_OK=false
  if claude plugin marketplace add agentic-control-plane/claude-code-acp-plugin >/dev/null 2>&1 \
     || claude plugin marketplace update acp >/dev/null 2>&1; then
    claude plugin install agentic-control-plane@acp >/dev/null 2>&1 || true
    if claude plugin list 2>/dev/null | grep -q "agentic-control-plane"; then
      CLAUDE_PLUGIN_OK=true
    fi
  fi

  CLAUDE_SETTINGS="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude"
  if [ ! -f "$CLAUDE_SETTINGS" ]; then
    echo '{}' > "$CLAUDE_SETTINGS"
  fi

  if [ "$CLAUDE_PLUGIN_OK" = true ]; then
    # The plugin's hooks.json now governs — REMOVE any direct govern.mjs
    # entries a previous installer wrote, or every tool call is governed
    # (and logged) twice. Preserves all non-ACP hooks.
    node -e "
      const fs = require('fs');
      const p = process.argv[1];
      let s = {};
      try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      if (s.hooks) {
        const isGovernEntry = (e) =>
          Array.isArray(e.hooks) && e.hooks.some(h => typeof h.command === 'string' && h.command.includes('govern.mjs'));
        for (const ev of ['SessionStart', 'PreToolUse', 'PostToolUse']) {
          if (Array.isArray(s.hooks[ev])) s.hooks[ev] = s.hooks[ev].filter(e => !isGovernEntry(e));
        }
      }
      fs.writeFileSync(p, JSON.stringify(s, null, 2));
    " "$CLAUDE_SETTINGS"
    # The plugin bundles the ACP MCP server — drop the legacy user-scope
    # registration so the tools don't appear twice.
    CLAUDE_JSON="$HOME/.claude.json"
    if [ -f "$CLAUDE_JSON" ]; then
      node -e "
        const fs = require('fs');
        const p = process.argv[1];
        let c = {};
        try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        if (c.mcpServers && c.mcpServers.acp) { delete c.mcpServers.acp; fs.writeFileSync(p, JSON.stringify(c, null, 2)); }
      " "$CLAUDE_JSON"
    fi
    echo "  ${C_GREEN}✓${C_RESET} [Claude Code] ACP plugin installed (hooks + skills + MCP, auto-updating)"
  else
    # Fallback for Claude Code CLIs without plugin-marketplace support:
    # direct hook wiring + user-scope MCP, exactly as before.
    #
    # SessionStart carries the paired-arrival attestation (/govern/attest,
    # gatewaystack-connect#595) — the mechanism that proves a hook is really
    # running. Only govern.mjs 0.9.0+ has a handler for it; older copies
    # dispatch unknown events to handlePreToolUse, which would POST
    # /govern/tool-use with an undefined tool_name at every session start
    # (why #40's unconditional wiring was reverted in #41). So probe the
    # copy actually written to THIS machine: govern.mjs is fetched from the
    # plugin repo at install time, so the day a handleSessionStart ships
    # there, fresh installs start attesting with no installer release — and
    # the bundled offline fallback (no handler) stays safely un-wired.
    if grep -q "handleSessionStart" "$CONFIG_DIR/govern.mjs" 2>/dev/null; then
      ACP_FALLBACK_EVENTS="['SessionStart', 'PreToolUse', 'PostToolUse']"
    else
      ACP_FALLBACK_EVENTS="['PreToolUse', 'PostToolUse']"
    fi
    node -e "
      const fs = require('fs');
      const p = process.argv[1];
      let s = {};
      try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      s.hooks = s.hooks || {};
      const hookEntry = {
        matcher: '.*',
        hooks: [{ type: 'command', command: 'env ACP_CLIENT=claude-code-plugin node \$HOME/.acp/govern.mjs', timeout: 5 }]
      };
      function isGovernEntry(e) {
        return Array.isArray(e.hooks) && e.hooks.some(h => typeof h.command === 'string' && h.command.includes('govern.mjs'));
      }
      // Which events to wire is decided in bash above (ACP_FALLBACK_EVENTS):
      // SessionStart only when the installed govern.mjs actually has a
      // handleSessionStart (0.9.0+). Stale SessionStart govern entries are
      // cleaned up either way — but never invent an empty hooks array for
      // an event we neither had nor wire.
      const events = ${ACP_FALLBACK_EVENTS};
      for (const ev of ['SessionStart', 'PreToolUse', 'PostToolUse']) {
        if (!events.includes(ev) && !Array.isArray(s.hooks[ev])) continue;
        s.hooks[ev] = (Array.isArray(s.hooks[ev]) ? s.hooks[ev] : []).filter(e => !isGovernEntry(e));
        if (events.includes(ev)) s.hooks[ev].push(hookEntry);
      }
      fs.writeFileSync(p, JSON.stringify(s, null, 2));
    " "$CLAUDE_SETTINGS"
    CLAUDE_JSON="$HOME/.claude.json"
    [ -f "$CLAUDE_JSON" ] || echo '{}' > "$CLAUDE_JSON"
    node -e "
      const fs = require('fs');
      const p = process.argv[1];
      let c = {};
      try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      c.mcpServers = c.mcpServers || {};
      c.mcpServers.acp = {
        command: 'sh',
        args: ['-c', 'exec npx -y mcp-remote https://api.agenticcontrolplane.com/mcp --header \"Authorization: Bearer \$(cat ~/.acp/credentials)\"'],
      };
      fs.writeFileSync(p, JSON.stringify(c, null, 2));
    " "$CLAUDE_JSON"
    echo "  ${C_GREEN}✓${C_RESET} [Claude Code] hooks + MCP registered directly (plugin CLI unavailable — update Claude Code for auto-updates)"
  fi

  # ── Cost X-ray wrapper (pricing out of the box) ─────────────────────
  # Hooks govern tool calls but can't see model traffic. `claude-acp` also
  # routes MODEL calls through the ACP proxy so every session is priced
  # (per agent / session / action). BYO auth: ACP forwards YOUR credential —
  # subscription OAuth or API key — so Anthropic bills you exactly as
  # before; ACP only observes and governs. Deliberately a separate command:
  # plain `claude` stays untouched as the always-working escape hatch.
  # Cloud-only: model-call pricing needs the proxy, so --local skips all of
  # this (no wrapper, no PATH edit — local mode touches no shell rc files).
  if [ "$LOCAL_MODE" = false ]; then
  mkdir -p "$CONFIG_DIR/bin"
  cat > "$CONFIG_DIR/bin/acp-session-summary" << 'SUMMARY'
#!/bin/sh
# ACP end-of-session summary — what the session cost + a deep link to its
# X-ray. Called by claude-acp on exit; silent on any failure.
ACP_KEY="$(cat "$HOME/.acp/credentials" 2>/dev/null)"
[ -z "$ACP_KEY" ] && exit 0
export ACP_KEY
node -e '
const key = process.env.ACP_KEY;
fetch("https://api.agenticcontrolplane.com/api/v1/runs?window=6h", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(2500) })
  .then((r) => r.json())
  .then(({ runs }) => {
    const mine = (runs ?? []).filter((r) => (r.clientName ?? "").startsWith("claude-c")).sort((a, b) => b.endMs - a.endMs)[0];
    if (!mine) return;
    const cost = mine.costCents >= 100 ? `$${(mine.costCents / 100).toFixed(2)}` : `${Math.round(mine.costCents * 10) / 10}¢`;
    const at = mine.byoAuth ? " @ API rates" : "";
    const parts = [`${mine.modelCalls} model call${mine.modelCalls === 1 ? "" : "s"}`, `${mine.toolCalls} tool call${mine.toolCalls === 1 ? "" : "s"}`];
    if (mine.costCents > 0) parts.push(`${cost}${at}`);
    if (mine.denies > 0) parts.push(`${mine.denies} denied`);
    console.log(`\n  ACP · session governed: ${parts.join(" · ")}`);
    console.log(`  → https://cloud.agenticcontrolplane.com/sessions/${encodeURIComponent(mine.runKey)}\n`);
  })
  .catch(() => {});
' 2>/dev/null
exit 0
SUMMARY
  chmod +x "$CONFIG_DIR/bin/acp-session-summary"

  cat > "$CONFIG_DIR/bin/claude-acp" << 'WRAPPER'
#!/bin/sh
# claude-acp — Claude Code with the ACP cost X-ray.
# Model calls route through the ACP proxy (priced + governed); Anthropic
# bills your own subscription/API key (ACP forwards your credential, never
# its own). Plain `claude` remains untouched. Docs: agenticcontrolplane.com
ACP_KEY="$(cat "$HOME/.acp/credentials" 2>/dev/null)"
if [ -z "$ACP_KEY" ]; then
  echo "claude-acp: no ACP credentials (~/.acp/credentials) — run /acp-connect. Starting plain claude." >&2
  exec claude "$@"
fi
ANTHROPIC_BASE_URL="${ACP_PROXY_BASE:-https://api.agenticcontrolplane.com/anthropic}" \
ANTHROPIC_CUSTOM_HEADERS="x-acp-key: $ACP_KEY" \
claude "$@"
STATUS=$?
# End-of-session: what it cost + a link to the X-ray. Never blocks exit.
"$HOME/.acp/bin/acp-session-summary" 2>/dev/null || true
exit $STATUS
WRAPPER
  chmod +x "$CONFIG_DIR/bin/claude-acp"

  # Put ~/.acp/bin on PATH (idempotent; marked line so upgrades don't stack)
  PATH_LINE='export PATH="$HOME/.acp/bin:$PATH" # acp-installer'
  ADDED_PATH=false
  for RC in "$HOME/.zshrc" "$HOME/.bashrc"; do
    if [ -f "$RC" ] && ! grep -q '\.acp/bin' "$RC" 2>/dev/null; then
      printf '\n%s\n' "$PATH_LINE" >> "$RC"
      ADDED_PATH=true
    fi
  done
  if [ ! -f "$HOME/.zshrc" ] && [ ! -f "$HOME/.bashrc" ] && ! grep -q '\.acp/bin' "$HOME/.profile" 2>/dev/null; then
    printf '\n%s\n' "$PATH_LINE" >> "$HOME/.profile"
    ADDED_PATH=true
  fi
  echo "  ${C_GREEN}✓${C_RESET} [Claude Code] Cost X-ray wrapper installed: claude-acp"
  [ "$ADDED_PATH" = true ] && echo "  ${C_DIM}[Claude Code] Added ~/.acp/bin to PATH (open a new terminal to pick it up)${C_RESET}"
  fi # LOCAL_MODE=false (cost X-ray wrapper)

  INSTALLED="${INSTALLED:+$INSTALLED, }Claude Code"
fi

# ── Step 1b: Cursor setup ────────────────────────────────────────────

if [ "$HAS_CURSOR" = true ]; then
  echo "  [Cursor] Setting up governance hooks..."

  # govern.mjs is shared — written above, before any client-specific steps.
  CURSOR_HOOKS="$HOME/.cursor/hooks.json"
  mkdir -p "$HOME/.cursor"
  if [ ! -f "$CURSOR_HOOKS" ]; then
    echo '{}' > "$CURSOR_HOOKS"
  fi
  # Idempotent merge. Cursor's hook keys are lowercase.
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    cfg.hooks = cfg.hooks || {};
    const hookEntry = {
      matcher: '.*',
      hooks: [{ type: 'command', command: 'env ACP_CLIENT=cursor node \$HOME/.acp/govern.mjs', timeout: 5 }]
    };
    function isGovernEntry(e) {
      return Array.isArray(e.hooks) && e.hooks.some(h => typeof h.command === 'string' && h.command.includes('govern.mjs'));
    }
    // Upgrade-safe: remove any existing govern.mjs entry, then add the current one.
    for (const ev of ['preToolUse', 'postToolUse']) {
      cfg.hooks[ev] = (Array.isArray(cfg.hooks[ev]) ? cfg.hooks[ev] : []).filter(e => !isGovernEntry(e));
      cfg.hooks[ev].push(hookEntry);
    }
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  " "$CURSOR_HOOKS"
  echo "  ${C_GREEN}✓${C_RESET} [Cursor] preToolUse + postToolUse hooks registered"

  # ACP introspection MCP — same mcp-remote stdio shape as Claude Code,
  # into Cursor's ~/.cursor/mcp.json.
  CURSOR_MCP="$HOME/.cursor/mcp.json"
  [ -f "$CURSOR_MCP" ] || echo '{}' > "$CURSOR_MCP"
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    let c = {};
    try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    c.mcpServers = c.mcpServers || {};
    c.mcpServers.acp = {
      command: 'sh',
      args: ['-c', 'exec npx -y mcp-remote https://api.agenticcontrolplane.com/mcp --header \"Authorization: Bearer \$(cat ~/.acp/credentials)\"'],
    };
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  " "$CURSOR_MCP"
  echo "  ${C_GREEN}✓${C_RESET} [Cursor] ACP introspection MCP registered"
  INSTALLED="${INSTALLED:+$INSTALLED, }Cursor"
fi

# ── Step 1c: Codex CLI setup ──────────────────────────────────────────

if [ "$HAS_CODEX" = true ]; then
  echo "  [Codex] Setting up governance hooks..."

  # Enable the hooks feature in ~/.codex/config.toml. The flag was renamed:
  # `codex_hooks` was the original (Stage::UnderDevelopment, off by default),
  # and `hooks` is canonical from 0.145.0 onward — Stable and default-enabled,
  # with `codex_hooks` kept as a deprecated alias that warns on every launch.
  # Writing the wrong one is not cosmetic in either direction: `hooks` on an
  # old build is an unknown key (hooks stay off, governance dark), and
  # `codex_hooks` on a new build nags the user forever. So detect and pick.
  #
  # Non-Bash tools are unhooked on every version; they go through the MCP
  # connector plus the AGENTS.md directive below. See /integrations/codex.
  CODEX_TOML="$HOME/.codex/config.toml"
  mkdir -p "$HOME/.codex"
  [ -f "$CODEX_TOML" ] || touch "$CODEX_TOML"

  # "codex-cli 0.145.0" -> "0.145.0"; empty if codex isn't runnable.
  CODEX_VER="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

  # Idempotent: only touch config.toml if the right flag isn't already set.
  # Uses node for string manipulation; avoids a TOML parser dependency.
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    const ver = process.argv[2] || '';
    // Unknown version => assume old build and keep the alias. It warns but
    // works on new builds; the canonical key would silently no-op on old ones.
    // Governance staying ON is worth a deprecation notice.
    const parts = ver.split('.').map(Number);
    const canonical = parts.length === 3 && !parts.some(isNaN) &&
      (parts[0] > 0 || parts[1] > 145 || (parts[1] === 145 && parts[2] >= 0));
    const key = canonical ? 'hooks' : 'codex_hooks';
    let src = '';
    try { src = fs.readFileSync(p, 'utf8'); } catch {}
    const wanted = new RegExp('^\\\\s*' + key + '\\\\s*=\\\\s*true\\\\s*\$', 'm');
    if (wanted.test(src)) process.exit(0);
    // On a canonical build, retire the deprecated alias rather than stacking
    // both keys — two sources of truth is how the nag survives an 'upgrade'.
    if (canonical) src = src.replace(/^[ \t]*codex_hooks[ \t]*=[ \t]*true[ \t]*\r?\n?/m, '');
    // Match the header line only — never the newline after it, or the insert
    // re-adds one and leaves a blank line behind.
    if (/^\[features\][ \t]*\r?\$/m.test(src)) {
      src = src.replace(/^(\[features\][ \t]*)\r?\$/m, '\$1\n' + key + ' = true');
    } else {
      if (src.length && !src.endsWith('\n')) src += '\n';
      src += (src.length ? '\n' : '') + '[features]\n' + key + ' = true\n';
    }
    if (!src.endsWith('\n')) src += '\n';
    fs.writeFileSync(p, src);
  " "$CODEX_TOML" "$CODEX_VER"

  # Add [mcp_servers.acp] block if not present. Uses sh -c so the
  # Authorization header reads ~/.acp/credentials at runtime — no install-
  # time API key needed, and credential rotation is automatic (overwrite
  # the file, restart Codex).
  # Cloud-only: the MCP connector and the AGENTS.md acp_check directive both
  # talk to the hosted gateway. --local wires neither — local mode must make
  # zero network calls, so Codex gets hook coverage (shell commands) only.
  if [ "$LOCAL_MODE" = false ] && ! grep -q "^\[mcp_servers\.acp\]" "$CODEX_TOML"; then
    cat >> "$CODEX_TOML" << 'MCPBLOCK'

[mcp_servers.acp]
command = "sh"
args = ["-c", 'exec npx -y mcp-remote https://api.agenticcontrolplane.com/mcp --header "Authorization: Bearer $(cat ~/.acp/credentials)"']
MCPBLOCK
  fi

  # Register Pre- and Post-ToolUse hooks in ~/.codex/hooks.json.
  #
  # ACP_HARNESS=codex is load-bearing, not decoration. govern.mjs branches on
  # it twice: (1) Codex has no `ask` semantic on the wire and acts on `deny`
  # only, so an ask must be emitted as deny-plus-approval-link or the human
  # gate silently passes through as allowed; (2) Codex rejects `updatedInput`,
  # so the scoped-token injection path must be skipped or the hook is marked
  # failed and the tool runs anyway, minus the token. Without this var
  # govern.mjs defaults to HARNESS=claude-code and does neither.
  # Same JSON shape as Claude Code settings.json.
  CODEX_HOOKS="$HOME/.codex/hooks.json"
  [ -f "$CODEX_HOOKS" ] || echo '{}' > "$CODEX_HOOKS"
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    s.hooks = s.hooks || {};
    const hookEntry = {
      matcher: '.*',
      hooks: [{ type: 'command', command: 'env ACP_CLIENT=codex ACP_HARNESS=codex node \$HOME/.acp/govern.mjs', timeout: 5 }]
    };
    function isGovernEntry(e) {
      return Array.isArray(e.hooks) && e.hooks.some(h => typeof h.command === 'string' && h.command.includes('govern.mjs'));
    }
    // Upgrade-safe: remove any existing govern.mjs entry, then add the current one.
    for (const ev of ['PreToolUse', 'PostToolUse']) {
      s.hooks[ev] = (Array.isArray(s.hooks[ev]) ? s.hooks[ev] : []).filter(e => !isGovernEntry(e));
      s.hooks[ev].push(hookEntry);
    }
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
  " "$CODEX_HOOKS"

  # Write/update ~/.codex/AGENTS.md with the ACP governance directive.
  # Codex reads AGENTS.md at every session start; this is how we tell it
  # to call acp_check before non-Bash tools (hooks only cover Bash today).
  # Idempotent: the ACP section is delimited by markers, so re-running
  # replaces only our section and preserves every other instruction.
  if [ "$LOCAL_MODE" = false ]; then
  CODEX_AGENTS="$HOME/.codex/AGENTS.md"
  [ -f "$CODEX_AGENTS" ] || touch "$CODEX_AGENTS"
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    const START = '<!-- acp:begin — Agentic Control Plane governance -->';
    const END = '<!-- acp:end -->';
    const section = [
      START,
      '## ACP Governance',
      '',
      'You are governed by Agentic Control Plane. Every tool call is logged and policy-checked.',
      '',
      '- **Bash commands** are automatically intercepted by the ACP PreToolUse hook. Nothing extra to do.',
      '- **Non-Bash tools** (Read, Edit, Write, WebFetch, MCP tools) are NOT hooked in current Codex.',
      '  Before calling any non-Bash tool, first call the \`acp_check\` MCP tool from the \`acp\` server',
      '  with \`{tool_name, tool_input}\`. Proceed only if the response is \`{decision: \"allow\"}\`.',
      '  If \`deny\`, stop and surface the reason to the user.',
      '- **Skip \`acp_check\`** for the meta-tools \`acp_check\` and \`acp_status\` themselves.',
      '',
      'Activity log: https://cloud.agenticcontrolplane.com/activity',
      END,
      '',
    ].join('\n');
    let src = '';
    try { src = fs.readFileSync(p, 'utf8'); } catch {}
    const startIdx = src.indexOf(START);
    const endIdx = src.indexOf(END);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      // Replace existing ACP section (drop one trailing newline if present)
      let tailStart = endIdx + END.length;
      if (src[tailStart] === '\n') tailStart++;
      src = src.substring(0, startIdx) + section + src.substring(tailStart);
    } else {
      // Append new section, ensuring a blank line before it
      if (src && !src.endsWith('\n')) src += '\n';
      src += (src ? '\n' : '') + section;
    }
    fs.writeFileSync(p, src);
  " "$CODEX_AGENTS"
  echo "  [Codex] AGENTS.md directive installed — Codex will call acp_check before non-Bash tools"
  echo "  ${C_GREEN}✓${C_RESET} [Codex] hooks feature enabled + PreToolUse/PostToolUse hooks + MCP connector wired"
  else
  echo "  ${C_GREEN}✓${C_RESET} [Codex] hooks feature enabled + PreToolUse/PostToolUse hooks (local: shell commands governed on-device)"
  fi # LOCAL_MODE (Codex cloud wiring)
  # Codex gates hooks behind a one-time review (its hook trust store):
  # a hooks.json it hasn't been told to trust is listed but silently never
  # run. There is no flag we could (or should) set for the user — the
  # review is the point. Say it, loudly, or the hook is dead on arrival.
  echo "  ${C_RED}!${C_RESET} [Codex] One-time step: run ${C_DIM}/hooks${C_RESET} inside Codex and trust the ACP hook."
  echo "    Codex silently skips hooks it hasn't reviewed — until you do this, Codex is not governed."
  echo "    Re-run this installer and you must trust it again — the hash covers the hook command."
  INSTALLED="${INSTALLED:+$INSTALLED, }Codex"
fi

# ── Step 1d: OpenClaw setup ───────────────────────────────────────────

if [ "$HAS_OPENCLAW" = true ]; then
  echo "  [OpenClaw] Installing governance plugin..."
  openclaw plugins install @gatewaystack/acp-governance 2>/dev/null && {
    echo "  ${C_GREEN}✓${C_RESET} [OpenClaw] Plugin installed"
    INSTALLED="${INSTALLED:+$INSTALLED, }OpenClaw"
  } || {
    echo "  ${C_RED}✗${C_RESET} [OpenClaw] Plugin install failed — try: openclaw plugins install @gatewaystack/acp-governance"
  }
fi

# ── Step 1e: opencode setup ───────────────────────────────────────────

# Cloud-only: the acp-opencode plugin is npm-fetched by opencode itself and
# governs via the workspace token — local decisions aren't wired there yet,
# so --local skips it (same rule as the Codex MCP connector).
if [ "$HAS_OPENCODE" = true ] && [ "$LOCAL_MODE" = true ]; then
  echo "  ${C_DIM}[opencode] Skipped in --local mode (its ACP plugin needs a workspace; local decisions aren't wired there yet).${C_RESET}"
fi
if [ "$HAS_OPENCODE" = true ] && [ "$LOCAL_MODE" = false ]; then
  echo "  [opencode] Registering governance plugin..."

  # opencode governs via the published acp-opencode plugin (npm), which it
  # auto-installs from its own config on next start. Unlike Claude Code /
  # Cursor / Codex (which shell out to ~/.acp/govern.mjs), opencode runs the
  # plugin's hooks in-process: permission.ask (allow/deny/ask), a deny
  # backstop, and a zero-credential local metering plane. Same
  # ~/.acp/credentials token, so one auth covers every harness.
  OPENCODE_JSON="$HOME/.config/opencode/opencode.json"
  mkdir -p "$HOME/.config/opencode"
  [ -f "$OPENCODE_JSON" ] || printf '{\n  "$schema": "https://opencode.ai/config.json"\n}\n' > "$OPENCODE_JSON"

  # Migration: older installers wrote an inline plugin here. Remove it so the
  # npm plugin doesn't end up governing every tool call twice.
  rm -f "$HOME/.config/opencode/plugin/acp-govern.ts"

  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    let c = {};
    try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    c.plugin = Array.isArray(c.plugin) ? c.plugin : [];
    if (!c.plugin.includes("acp-opencode")) c.plugin.push("acp-opencode");
    // permission "ask" is what lets ACP allow/ask reach a tool call; fill gaps
    // only, never override a choice the user set deliberately.
    c.permission = c.permission || {};
    for (const t of ["bash", "edit", "webfetch"]) if (!c.permission[t]) c.permission[t] = "ask";
    // ACP introspection MCP (opencode.ai/docs/mcp-servers).
    c.mcp = c.mcp || {};
    c.mcp.acp = {
      type: "local",
      command: ["sh", "-c", "exec npx -y mcp-remote https://api.agenticcontrolplane.com/mcp --header \"Authorization: Bearer $(cat ~/.acp/credentials)\""],
      enabled: true,
    };
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  ' "$OPENCODE_JSON" && {
    echo "  ${C_GREEN}✓${C_RESET} [opencode] Plugin registered (acp-opencode) + permission gate + introspection MCP"
    echo "     Restart opencode — it installs the plugin from npm and governs every tool call."
    INSTALLED="${INSTALLED:+$INSTALLED, }opencode"
  } || {
    echo "  ${C_RED}✗${C_RESET} [opencode] Config update failed — add \"plugin\": [\"acp-opencode\"] to $OPENCODE_JSON"
  }
fi

# ── Local mode: skip login, seed a default policy, done ───────────────
if [ "$LOCAL_MODE" = true ]; then
  if [ ! -f "$CONFIG_DIR/policy.json" ]; then
    cat > "$CONFIG_DIR/policy.json" << 'POLICY'
{
  "_comment": "Local ACP policy — edit freely. decide.mjs walks keys most-specific → least (e.g. Bash.curl.api.github.com → Bash.curl → Bash). Values: allow | ask | deny. The safety floor (rm -rf /, mkfs, dd of a disk, fork bombs, force-push to main) always denies regardless of this file. 'default' applies when no rule matches.",
  "default": "allow",
  "rules": {
    "Bash.rm": "ask",
    "Bash.curl": "ask",
    "Bash.git.push": "ask",
    "Bash.chmod": "ask",
    "Bash.chown": "ask"
  }
}
POLICY
  fi
  echo ""
  echo "  ${C_GREEN}ALLOW${C_RESET}  local mode active — no account, nothing leaves your machine"
  echo "  ${C_DIM}Hooks installed for:${C_RESET} $INSTALLED"
  [ "$HAS_CODEX" = true ] && echo "  ${C_DIM}Codex note: its hooks cover shell commands today; non-Bash tools aren't hooked by Codex yet.${C_RESET}"
  echo ""
  echo "  Decisions run on-device from ${C_DIM}~/.acp/policy.json${C_RESET} (edit it — allow / ask / deny)."
  echo "  Every call is logged to ${C_DIM}~/.acp/audit.jsonl${C_RESET}:"
  echo "    ${C_DIM}tail -f ~/.acp/audit.jsonl${C_RESET}"
  echo ""
  echo "  The safety floor always blocks the catastrophic (rm -rf /, mkfs, dd, fork bombs,"
  echo "  force-push to main) regardless of policy."
  echo ""
  echo "  Restart your AI client to activate the hook."
  echo "  Want team control, cost X-ray, and a shared console across everyone's agents?"
  echo "  Re-run without ${C_DIM}--local${C_RESET} to connect a workspace."
  echo ""
  exit 0
fi

# ── Step 2: Authenticate ──────────────────────────────────────────────

if [ -f "$CREDS_FILE" ]; then
  echo "  Credentials already configured."
  echo ""
  read -p "  Reconfigure? (y/N) " -n 1 -r </dev/tty
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "  You're all set. View your audit logs:"
    echo "  $DASHBOARD_BASE/activity"
    echo ""
    exit 0
  fi
fi

# Snapshot any pre-existing key so the verify step below can tell a
# freshly pasted key apart from one left over before a reconfigure.
CREDS_BEFORE=""
if [ -f "$CREDS_FILE" ]; then
  CREDS_BEFORE="$(cat "$CREDS_FILE" 2>/dev/null || true)"
fi

# ── Done ──────────────────────────────────────────────────────────────

echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Hooks installed for: $INSTALLED"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Get the key ONTO THIS MACHINE (device code, RFC 8628) ─────────────
# April's c099916 removed the token paste on the grounds that "browser
# handles provisioning now". Provisioning did move to the browser — but a
# web page cannot write ~/.acp/credentials, so *delivery* silently became a
# human copy-paste, and anyone who closed the tab ended up with hooks and no
# key. Device code closes that: the human approves a short code in a browser
# they're already signed into, and THIS SCRIPT writes the key. Nothing is
# ever pasted, so nothing depends on shell quoting (which is what made the
# original paste flow unfixable on Windows and in curl|bash).
KEY_SEEN=false
ACP_UNGOVERNED=false
DEVICE_BUDGET=300   # seconds; the code itself lives longer, but a curl|bash
                    # must not hang indefinitely if the user walks away.

DEVICE_INFO="$(node -e '
  const API = process.argv[1];
  (async () => {
    try {
      const r = await fetch(API + "/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!r.ok) process.exit(1);
      const d = await r.json();
      if (!d.device_code || !d.user_code) process.exit(1);
      process.stdout.write([
        d.user_code,
        d.verification_uri_complete || d.verification_uri,
        d.device_code,
        d.interval || 5,
      ].join("\t"));
    } catch { process.exit(1); }
  })();
' "$API_BASE" 2>/dev/null || true)"

USER_CODE="$(printf "%s" "$DEVICE_INFO" | cut -f1)"
VERIFY_URL="$(printf "%s" "$DEVICE_INFO" | cut -f2)"
DEVICE_CODE="$(printf "%s" "$DEVICE_INFO" | cut -f3)"
DEVICE_INTERVAL="$(printf "%s" "$DEVICE_INFO" | cut -f4)"

if [ -n "$DEVICE_CODE" ]; then
  echo "  Approve this machine — your code is:"
  echo ""
  echo "      ${C_GREEN}$USER_CODE${C_RESET}"
  echo ""
  if command -v open &> /dev/null; then
    open "$VERIFY_URL" 2>/dev/null || true
    echo "  ${C_DIM}Opening your browser (code is pre-filled)…${C_RESET}"
  elif command -v xdg-open &> /dev/null; then
    xdg-open "$VERIFY_URL" 2>/dev/null || true
    echo "  ${C_DIM}Opening your browser (code is pre-filled)…${C_RESET}"
  else
    echo "  Approve at: $VERIFY_URL"
  fi
  echo ""
  printf "  %sWaiting for approval (up to %ss; Ctrl+C is safe — re-run any time)%s " \
    "$C_DIM" "$DEVICE_BUDGET" "$C_RESET"

  # Writes the key itself on success. Progress goes to stderr so stdout
  # stays clean for anything piping this installer.
  if node -e '
    const fs = require("fs");
    const [API, deviceCode, credsFile, budget, interval] = process.argv.slice(1);
    const deadline = Date.now() + Number(budget) * 1000;
    let wait = Number(interval) * 1000;
    (async () => {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, wait));
        let res, body;
        try {
          res = await fetch(API + "/device/token", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ device_code: deviceCode }),
          });
          body = await res.json();
        } catch { process.stderr.write("~"); continue; }
        if (res.ok && typeof body.apiKey === "string" && body.apiKey.trim()) {
          fs.writeFileSync(credsFile, body.apiKey.trim() + "\n", { mode: 0o600 });
          try { fs.chmodSync(credsFile, 0o600); } catch {}
          process.exit(0);
        }
        if (body && body.error === "slow_down") { wait += 5000; process.stderr.write("_"); continue; }
        if (body && body.error === "authorization_pending") { process.stderr.write("."); continue; }
        process.exit(1);   // expired_token, access_denied, anything unexpected
      }
      process.exit(1);
    })();
  ' "$API_BASE" "$DEVICE_CODE" "$CREDS_FILE" "$DEVICE_BUDGET" "$DEVICE_INTERVAL"; then
    KEY_SEEN=true
  fi
else
  # Never brick: if /device/code is unreachable, fall back to the browser
  # page and the manual one-liner rather than leaving the user with nothing.
  AUTH_URL="$DASHBOARD_BASE/plugin/authorize?setup=cli"
  if command -v open &> /dev/null; then
    open "$AUTH_URL" 2>/dev/null || true
  elif command -v xdg-open &> /dev/null; then
    xdg-open "$AUTH_URL" 2>/dev/null || true
  fi
  echo "  ${C_DIM}Automatic setup unavailable — finish in the browser:${C_RESET}"
  echo "  $AUTH_URL"
  echo ""
  echo "  Then save the key it shows you:"
  echo ""
  echo "    echo 'YOUR_API_KEY' > ~/.acp/credentials"
fi

# Reconfigure edge: approval didn't complete but a key was already here —
# verify that one rather than declaring the machine ungoverned.
if [ "$KEY_SEEN" = false ] && [ -n "$CREDS_BEFORE" ]; then
  KEY_SEEN=true
fi
echo ""
echo ""
if [ "$KEY_SEEN" = true ]; then
  ACP_KEY="$(head -n 1 "$CREDS_FILE" 2>/dev/null | tr -d '[:space:]')"
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "Authorization: Bearer $ACP_KEY" \
    "$API_BASE/api/v1/runs?window=6h" 2>/dev/null || true)"
  if [ "$HTTP_CODE" = "200" ]; then
    # First GOVERNED call, through the real hook path (node + govern.mjs +
    # gateway + audit log). Distinguishes "installed and idle" from "hook
    # broken" server-side, and the user's dashboard gets its first row.
    BEACON_SESSION="install-$(date +%s)"
    printf '{"tool_name":"install.verify","tool_input":{"harness":"%s"},"session_id":"%s","hook_event_name":"PreToolUse"}' \
      "$INSTALLED" "$BEACON_SESSION" \
      | env ACP_CLIENT=installer node "$CONFIG_DIR/govern.mjs" >/dev/null 2>&1 || true
    echo "  ${C_GREEN}ALLOW${C_RESET}  install.verify · key valid · first governed call logged"
    # The aha permalink (gatewaystack-connect#313): first value is a URL in
    # the terminal — the governed run this install just created, by its key
    # (runKey == session_id), not a generic dashboard page.
    echo "  ${C_DIM}Your first governed run:${C_RESET} $DASHBOARD_BASE/sessions/$BEACON_SESSION"
    # Two-plane coverage report (gatewaystack-connect#367): what this
    # workspace's traffic actually has, per client, with the exact missing
    # step — the same contract the console Coverage card renders. On a fresh
    # workspace there's only the beacon, so print the one-liner instead.
    SLUG="$(printf '%s' "$ACP_KEY" | cut -d_ -f2)"
    COV_JSON="$(curl -s --max-time 10 -H "Authorization: Bearer $ACP_KEY" "$API_BASE/$SLUG/admin/coverage" 2>/dev/null || true)"
    if [ -n "$COV_JSON" ]; then
      printf '%s' "$COV_JSON" | node -e '
        let raw=""; process.stdin.on("data",(d)=>raw+=d);
        process.stdin.on("end",()=>{ try{
          const d=JSON.parse(raw); if(!d.ok||!Array.isArray(d.clients)) return;
          const real=d.clients.filter((c)=>c.client!=="installer");
          console.log("");
          console.log("  Coverage — interception governs tool calls, the proxy prices model calls:");
          if(!real.length){
            console.log("    interception ✓ (verified just now) · proxy comes up with your first model call through it");
          }
          for(const c of real){
            const m=(p)=>p&&p.active?"✓":"✗";
            console.log("    "+c.client.padEnd(22)+" interception "+m(c.interception)+" · proxy "+m(c.proxy));
            if(c.fix) console.log("      → "+c.fix.run);
          }
        }catch(e){} });' 2>/dev/null || true
      echo "  ${C_DIM}Live checklist:${C_RESET} $DASHBOARD_BASE  (Coverage card, per agent)"
    fi
  else
    echo "  ${C_RED}Couldn't verify the key${C_RESET} (HTTP ${HTTP_CODE:-000})."
    echo "  ${C_DIM}Check that ~/.acp/credentials contains exactly the key the page showed,${C_RESET}"
    echo "  ${C_DIM}then confirm your first calls at${C_RESET} $DASHBOARD_BASE/activity"
  fi
else
  # Not fine. Hooks without a key are a silent no-op: govern.mjs finds no
  # token and lets every call through without a policy check or an audit
  # row, and the server cannot tell that machine apart from one that never
  # installed. Saying "that's fine" here is what left real users believing
  # they were governed while they weren't (gatewaystack-connect#594).
  ACP_UNGOVERNED=true
  echo "  ${C_RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
  echo "  ${C_RED}!  NOT GOVERNED YET — no API key saved${C_RESET}"
  echo "  ${C_RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
  echo ""
  echo "  The hooks are installed, but with no key they cannot reach ACP."
  echo "  Until you save one, every tool call runs UNCHECKED and nothing is"
  echo "  audited. This install is not protecting you yet."
  echo ""
  echo "  Finish logging in, then run:"
  echo ""
  echo "    echo 'YOUR_API_KEY' > ~/.acp/credentials"
  echo ""
  echo "  Then restart your agent and confirm at $DASHBOARD_BASE/activity"
fi
echo ""
if [ "$HAS_CLAUDE" = true ]; then
  echo "  Then restart Claude Code (Ctrl+C, then claude --continue)"
  echo ""
  echo "  Claude Code — two ways to run:"
  echo "    claude       tool calls governed + audited (hooks)"
  echo "    claude-acp   the above PLUS every model call priced —"
  echo "                 the cost X-ray, billed to your own account"
fi
if [ "$HAS_CURSOR" = true ]; then
  echo "  Then restart Cursor to activate the hook"
fi
if [ "$HAS_CODEX" = true ]; then
  echo "  Then restart Codex (Ctrl+C, then codex) to activate the hook"
fi
if [ "$HAS_OPENCLAW" = true ]; then
  echo "  Then restart OpenClaw to activate the plugin"
fi
echo ""

# Exit non-zero when the install finished without a usable key, so the state
# is detectable by a wrapper, a CI check, or the user's shell — not only by
# reading the banner. Distinct code (2) so it is not confused with a crash.
if [ "${ACP_UNGOVERNED:-false}" = true ]; then
  exit 2
fi
exit 0
