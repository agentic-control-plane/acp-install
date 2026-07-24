# acp-install

> One-line installer for **[Agentic Control Plane](https://agenticcontrolplane.com)** — auditable governance for every tool call from your AI agents.

## Install

```bash
curl -sf https://agenticcontrolplane.com/install.sh | bash
```

Works on macOS + Linux. Requires Node 18+ and one of: Claude Code, Cursor, OpenAI Codex CLI, OpenClaw.

### Local mode — no account, nothing leaves your machine

```bash
curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local
```

Governs your agents **entirely on-device**. No signup, no key, no phone-home. Decisions run from `~/.acp/policy.json` (`allow` / `ask` / `deny` per tool), a **safety floor** blocks the catastrophic (`rm -rf /`, `mkfs`, `dd` of a disk, fork bombs, force-push to `main`) regardless of policy, and every call is logged locally — see what your agent actually did:

```bash
tail -f ~/.acp/audit.jsonl
```

The same one command works across Claude Code, Cursor, and Codex. Want team control, cost X-ray, and a shared console across **everyone's** agents at the org level? Re-run without `--local` to connect a workspace — the local runtime is the free individual on-ramp; the cloud is the team upgrade.

Want the long version first? [Every file the installer writes, in plain language](https://agenticcontrolplane.com/install-explained) · [getting started](https://agenticcontrolplane.com/getting-started) · per-client guides for [Claude Code](https://agenticcontrolplane.com/integrations/claude-code) and [Codex CLI](https://agenticcontrolplane.com/integrations/codex)

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
- Phone home to any server other than `api.agenticcontrolplane.com` and (during auth) `cloud.agenticcontrolplane.com` — **and in `--local` mode, nothing leaves your machine at all** (decisions run on-device from `~/.acp/decide.mjs` + `~/.acp/policy.json`; no network calls)
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
