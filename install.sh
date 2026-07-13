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

if [ "$HAS_CLAUDE" = false ] && [ "$HAS_CURSOR" = false ] && [ "$HAS_CODEX" = false ] && [ "$HAS_OPENCLAW" = false ]; then
  echo "  ${C_RED}No supported AI clients detected.${C_RESET}"
  echo "  Supported: Claude Code, Cursor, OpenAI Codex CLI, OpenClaw"
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

echo ""
echo "  Agentic Control Plane"
echo "  Identity & governance for $TARGETS"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

mkdir -p "$CONFIG_DIR"

# ── Shared: write govern.mjs ──────────────────────────────────────────
# Single dispatcher script used by every client (Claude Code, Cursor,
# Codex). v0.4 dispatches PreToolUse and PostToolUse to the correct
# backend endpoint. PostToolUse is audit-only client-side in v0.4: it
# never modifies tool output but surfaces findings in the ACP dashboard.

echo "  [ACP] Installing governance hook script..."
cat > "$CONFIG_DIR/govern.mjs" << 'GOVERN'
#!/usr/bin/env node
import { readFileSync } from "fs";
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
  try { return readFileSync(join(homedir(), ".acp", "credentials"), "utf8").trim(); }
  catch { return null; }
}

const token = readToken();
if (!token) process.exit(0);

let input;
try { input = JSON.parse(readFileSync("/dev/stdin", "utf8")); }
catch { process.exit(0); }

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
chmod +x "$CONFIG_DIR/govern.mjs"

# ── Step 1a: Claude Code setup ────────────────────────────────────────

if [ "$HAS_CLAUDE" = true ]; then
  echo "  [Claude Code] Setting up governance hooks..."

  # Register Pre- and Post-ToolUse hooks in settings.json. Idempotent:
  # adds a govern.mjs entry to each event's hooks array only if missing.
  # Preserves any other hooks the user has configured.
  CLAUDE_SETTINGS="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude"
  if [ ! -f "$CLAUDE_SETTINGS" ]; then
    echo '{}' > "$CLAUDE_SETTINGS"
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
    // Upgrade-safe: remove any existing govern.mjs entry (stale or current),
    // then add the current one. Preserves any other hooks the user has.
    for (const ev of ['PreToolUse', 'PostToolUse']) {
      s.hooks[ev] = (Array.isArray(s.hooks[ev]) ? s.hooks[ev] : []).filter(e => !isGovernEntry(e));
      s.hooks[ev].push(hookEntry);
    }
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
  " "$CLAUDE_SETTINGS"
  echo "  ${C_GREEN}✓${C_RESET} [Claude Code] PreToolUse + PostToolUse hooks registered"

  # ── Cost X-ray wrapper (pricing out of the box) ─────────────────────
  # Hooks govern tool calls but can't see model traffic. `claude-acp` also
  # routes MODEL calls through the ACP proxy so every session is priced
  # (per agent / session / action). BYO auth: ACP forwards YOUR credential —
  # subscription OAuth or API key — so Anthropic bills you exactly as
  # before; ACP only observes and governs. Deliberately a separate command:
  # plain `claude` stays untouched as the always-working escape hatch.
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
  INSTALLED="${INSTALLED:+$INSTALLED, }Cursor"
fi

# ── Step 1c: Codex CLI setup ──────────────────────────────────────────

if [ "$HAS_CODEX" = true ]; then
  echo "  [Codex] Setting up governance hooks..."

  # Codex hooks are feature-flagged off by default (marked
  # Stage::UnderDevelopment in the Codex source). Flip [features].codex_hooks
  # in ~/.codex/config.toml. Note: PreToolUse in Codex only intercepts
  # the Bash tool today; non-Bash tools need the MCP connector path,
  # documented separately at /integrations/codex.
  CODEX_TOML="$HOME/.codex/config.toml"
  mkdir -p "$HOME/.codex"
  [ -f "$CODEX_TOML" ] || touch "$CODEX_TOML"

  # Idempotent: only modify config.toml if codex_hooks isn't already set.
  # Uses node for string manipulation; avoids a TOML parser dependency.
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    let src = '';
    try { src = fs.readFileSync(p, 'utf8'); } catch {}
    const hasFlag = /^\s*codex_hooks\s*=\s*true\s*\$/m.test(src);
    if (!hasFlag) {
      const hasFeatures = /^\[features\]\s*\$/m.test(src);
      if (hasFeatures) {
        // Insert codex_hooks = true on the line after [features]
        src = src.replace(/^(\[features\]\s*)\$/m, '\$1\ncodex_hooks = true');
      } else {
        // Append a new [features] section
        if (src.length && !src.endsWith('\n')) src += '\n';
        src += '\n[features]\ncodex_hooks = true\n';
      }
      fs.writeFileSync(p, src);
    }
  " "$CODEX_TOML"

  # Add [mcp_servers.acp] block if not present. Uses sh -c so the
  # Authorization header reads ~/.acp/credentials at runtime — no install-
  # time API key needed, and credential rotation is automatic (overwrite
  # the file, restart Codex).
  if ! grep -q "^\[mcp_servers\.acp\]" "$CODEX_TOML"; then
    cat >> "$CODEX_TOML" << 'MCPBLOCK'

[mcp_servers.acp]
command = "sh"
args = ["-c", 'exec npx -y mcp-remote https://mcp.agenticcontrolplane.com/mcp --header "Authorization: Bearer $(cat ~/.acp/credentials)"']
MCPBLOCK
  fi

  # Register Pre- and Post-ToolUse hooks in ~/.codex/hooks.json.
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
      hooks: [{ type: 'command', command: 'env ACP_CLIENT=codex node \$HOME/.acp/govern.mjs', timeout: 5 }]
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
  echo "  ${C_GREEN}✓${C_RESET} [Codex] codex_hooks enabled + PreToolUse/PostToolUse hooks + MCP connector wired"
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

echo "  Opening browser to log in and set up your workspace..."
echo ""

AUTH_URL="$DASHBOARD_BASE/plugin/authorize?setup=cli"
if command -v open &> /dev/null; then
  open "$AUTH_URL"
elif command -v xdg-open &> /dev/null; then
  xdg-open "$AUTH_URL"
else
  echo "  Open this URL in your browser:"
  echo "  $AUTH_URL"
  echo ""
fi

# ── Done ──────────────────────────────────────────────────────────────

echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Hooks installed for: $INSTALLED"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Complete setup in the browser. After logging in, the page"
echo "  will show your API key. Save it with:"
echo ""
echo "    echo 'YOUR_API_KEY' > ~/.acp/credentials"
echo ""

# ── Verify: wait for the key, then check it against the gateway ──────
# Best-effort success moment: poll up to 30s for ~/.acp/credentials to
# appear (or change, on reconfigure), then validate the key with one
# read-only request. Nothing here blocks or changes the install — on
# timeout the manual path above still works.
KEY_SEEN=false
printf "  %sWaiting for your API key (up to 30s; Ctrl+C skips — hooks are already installed)%s " "$C_DIM" "$C_RESET"
for _ in $(seq 1 30); do
  CREDS_NOW=""
  if [ -f "$CREDS_FILE" ]; then
    CREDS_NOW="$(cat "$CREDS_FILE" 2>/dev/null || true)"
  fi
  if [ -n "$CREDS_NOW" ] && [ "$CREDS_NOW" != "$CREDS_BEFORE" ]; then
    KEY_SEEN=true
    break
  fi
  printf "."
  sleep 1
done
# Reconfigure edge: key unchanged after 30s but present — verify it anyway.
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
    echo "  ${C_GREEN}ALLOW${C_RESET}  install.verify · key valid · workspace reachable"
    echo "  ${C_DIM}Your calls will appear at${C_RESET} $DASHBOARD_BASE/activity"
  else
    echo "  ${C_RED}Couldn't verify the key${C_RESET} (HTTP ${HTTP_CODE:-000})."
    echo "  ${C_DIM}Check that ~/.acp/credentials contains exactly the key the page showed,${C_RESET}"
    echo "  ${C_DIM}then confirm your first calls at${C_RESET} $DASHBOARD_BASE/activity"
  fi
else
  echo "  ${C_DIM}No key after 30s — that's fine. Finish in the browser, save the key${C_RESET}"
  echo "  ${C_DIM}with the command above, then check${C_RESET} $DASHBOARD_BASE/activity"
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
