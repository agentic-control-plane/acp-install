# acp-install

> One-line installer for **[Agentic Control Plane](https://agenticcontrolplane.com)** — auditable governance for every tool call from your AI agents.

## Install

```bash
curl -sf https://agenticcontrolplane.com/install.sh | bash
```

Works on macOS + Linux. Requires Node 18+ and one of: Claude Code, Cursor, OpenAI Codex CLI, OpenClaw.

## What the installer does

For whichever AI clients it detects:

1. **Writes `~/.acp/govern.mjs`** — a shared hook dispatcher script that sends every tool call to the ACP governance API and enforces allow/deny decisions locally.
2. **Registers PreToolUse + PostToolUse hooks** in the client's config:
   - Claude Code: `~/.claude/settings.json`
   - Cursor: `~/.cursor/hooks.json`
   - Codex: `~/.codex/hooks.json`
3. **For Codex only** — wires three layers:
   - Enables `[features].codex_hooks = true` in `~/.codex/config.toml`
   - Adds `[mcp_servers.acp]` for non-Bash tool governance via MCP (with runtime credential substitution — no API key in your dotfiles)
   - Writes an ACP section in `~/.codex/AGENTS.md` instructing Codex to call `acp_check` before non-Bash tool invocations
4. **Opens a browser** for OAuth to provision an ACP workspace and mint an API key
5. **Saves the key to `~/.acp/credentials`** (mode 0600)

The installer is **idempotent**: running it again upgrades existing entries in place without duplicating them or touching unrelated hooks/policies you've configured.

## Trust signals

- **Source**: this file — read it top-to-bottom, ~660 lines
- **SHA-256**: [`https://agenticcontrolplane.com/install.sh.sha256`](https://agenticcontrolplane.com/install.sh.sha256) — auto-updates on every Agentic Control Plane release
- **License**: MIT
- **Dry read**: `curl -sf https://agenticcontrolplane.com/install.sh | less`
- **Commit history**: every change is here in this repo

The canonical install URL is `agenticcontrolplane.com/install.sh` (served from the marketing site). This repo is the auditable mirror.

## What this script will NOT do

- Run any non-interactive commands without prompting if creds already exist (it asks "Reconfigure? (y/N)")
- Install to directories you don't own (`$HOME/.acp/`, `$HOME/.codex/`, `$HOME/.claude/`, `$HOME/.cursor/` only)
- Phone home to any server other than `api.agenticcontrolplane.com` and (during auth) `cloud.agenticcontrolplane.com`
- Modify anything outside the client config files documented above
- Install binaries or compile anything — it's a pure shell + Node.js script

## Uninstall

```bash
# Remove the ACP directory (credentials + govern.mjs)
rm -rf ~/.acp

# Remove the hooks from each detected client's config:
# - ~/.claude/settings.json        remove the "govern.mjs" entries under hooks.PreToolUse[] and hooks.PostToolUse[]
# - ~/.cursor/hooks.json           remove the "govern.mjs" entries under hooks.preToolUse[] and hooks.postToolUse[]
# - ~/.codex/hooks.json            remove the "govern.mjs" entries under hooks.PreToolUse[] and hooks.PostToolUse[]
# - ~/.codex/config.toml           remove the [mcp_servers.acp] block and [features].codex_hooks line
# - ~/.codex/AGENTS.md             remove the block between <!-- acp:begin --> and <!-- acp:end --> markers
```

A one-line `uninstall.sh` is planned. Until then, the blocks above are small enough to remove by hand.

## Reporting issues

- **Install broke something**: open an issue here → [github.com/agentic-control-plane/acp-install/issues](https://github.com/agentic-control-plane/acp-install/issues)
- **Governance behavior questions**: [agenticcontrolplane.com/faq](https://agenticcontrolplane.com/faq)
- **Integration details per client**: [agenticcontrolplane.com/integrations](https://agenticcontrolplane.com/integrations)

## License

MIT — see [LICENSE](LICENSE).

Not a coding-agent CLI? Framework agents use [acp-governance-sdks](https://github.com/agentic-control-plane/acp-governance-sdks); Hermes Agent uses [hermes-acp-plugin](https://github.com/agentic-control-plane/hermes-acp-plugin) (`pip install hermes-acp`).
