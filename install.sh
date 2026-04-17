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
  echo "  No supported AI clients detected."
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
      hookSpecificOutput: { permissionDecision: "deny" },
      systemMessage: `[ACP] Blocked: ${reason}`,
    }));
    process.exit(0);
  }
  try {
    const res = await fetch(`${ACP_API}/govern/tool-use`, { method: "POST", headers, body, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) { deny("ACP unreachable (HTTP " + res.status + ")"); return; }
    const data = await res.json();
    if (data.decision === "deny") deny(data.reason || "denied by policy");
  } catch {
    deny("ACP unreachable — tool call blocked for safety");
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
  echo "  [Claude Code] PreToolUse + PostToolUse hooks registered"
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
  echo "  [Cursor] preToolUse + postToolUse hooks registered"
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
  echo "  [Codex] codex_hooks enabled + PreToolUse/PostToolUse hooks + MCP connector wired"
  INSTALLED="${INSTALLED:+$INSTALLED, }Codex"
fi

# ── Step 1d: OpenClaw setup ───────────────────────────────────────────

if [ "$HAS_OPENCLAW" = true ]; then
  echo "  [OpenClaw] Installing governance plugin..."
  openclaw plugins install @gatewaystack/acp-governance 2>/dev/null && {
    echo "  [OpenClaw] Plugin installed"
    INSTALLED="${INSTALLED:+$INSTALLED, }OpenClaw"
  } || {
    echo "  [OpenClaw] Plugin install failed — try: openclaw plugins install @gatewaystack/acp-governance"
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

echo "  Opening browser to log in..."
echo ""

AUTH_URL="$DASHBOARD_BASE/plugin/authorize"
if command -v open &> /dev/null; then
  open "$AUTH_URL"
elif command -v xdg-open &> /dev/null; then
  xdg-open "$AUTH_URL"
else
  echo "  Open this URL in your browser:"
  echo "  $AUTH_URL"
  echo ""
fi

echo "  Opening browser to set up your workspace..."
echo ""

AUTH_URL="$DASHBOARD_BASE/plugin/authorize?setup=cli"
if command -v open &> /dev/null; then
  open "$AUTH_URL"
elif command -v xdg-open &> /dev/null; then
  xdg-open "$AUTH_URL"
else
  echo "  Open this URL in your browser:"
  echo "  $AUTH_URL"
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
if [ "$HAS_CLAUDE" = true ]; then
  echo "  Then restart Claude Code (Ctrl+C, then claude --continue)"
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
