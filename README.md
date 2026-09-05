# acp-install

> **Control the tool call, control the agent.**
> See and stop what your coding agent actually does — every command, edit, and fetch — with one control layer that works the same across Claude Code, Cursor, and Codex. Free for individuals — connected console by default, or fully on-device with `--local`.

<p align="center">
  <img src="demo/acp-local-demo.gif" width="820" alt="Real terminal recording: one command installs ACP local mode with no signup; a coding agent's force-push to main is blocked by the safety floor, a network call has to ask, normal work runs and is logged — and the same policy stops Codex too. tail ~/.acp/audit.jsonl shows every call and its decision.">
</p>
<p align="center"><sub>Real recording, nothing mocked — <a href="demo/README.md">how it's made / re-record it yourself</a>. 60&nbsp;seconds: install → agent blocked → asked → allowed → the audit log.</sub></p>

```bash
curl -sf https://agenticcontrolplane.com/install.sh | bash
```

Prefer fully on-device — no account, nothing leaves your machine? Add the flag:

```bash
curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local
```

One command. It detects whichever agents you run and puts the same guardrails in front of all of them:

- **A safety floor nothing can cross** — `rm -rf /`, `mkfs`, `dd` to a disk, a fork bomb, a force-push to `main` are blocked regardless of your policy (and regardless of how the command is spelled).
- **Your rules, one place** — `allow` / `ask` / `deny` per tool, applied identically to every agent: the shared console (connected), or `~/.acp/policy.json` (`--local`).
- **A log of what actually happened** — the live activity feed in the console, or in `--local` mode `tail -f ~/.acp/audit.jsonl`, fully on-device.

The same policy that stops Claude Code stops Codex. You configure control once, not once per vendor. The default install connects a workspace — free for individuals — with the cost X-ray and a shared console across everyone's agents. `--local` is the fully-private on-device mode; re-run without the flag any time to connect.

Works on macOS + Linux. Requires Node 18+ and one of: Claude Code, Cursor, OpenAI Codex CLI, OpenClaw, opencode, Qwen Code.

Want the long version first? [Every file the installer writes, in plain language](https://agenticcontrolplane.com/install-explained) · [getting started](https://agenticcontrolplane.com/getting-started) · per-client guides for [Claude Code](https://agenticcontrolplane.com/integrations/claude-code) and [Codex CLI](https://agenticcontrolplane.com/integrations/codex)

## What the installer does

For whichever AI clients it detects:

1. **Writes `~/.acp/govern.mjs`** — a shared hook dispatcher script that sends every tool call to the ACP governance API and enforces allow/deny decisions locally.
2. **Registers PreToolUse + PostToolUse hooks** in the client's config:
   - Claude Code: `~/.claude/settings.json`
   - Cursor: `~/.cursor/hooks.json`
   - Qwen Code: `~/.qwen/settings.json` (`hooks` + `mcpServers`)
   - Codex: `~/.codex/hooks.json`
3. **For Codex only** — wires three layers:
   - Enables the hooks feature in `~/.codex/config.toml` (`[features].hooks = true` on Codex 0.145.0+, the deprecated `codex_hooks` alias on older builds)
   - Adds `[mcp_servers.acp]` for non-Bash tool governance via MCP (with runtime credential substitution — no API key in your dotfiles)
   - Writes an ACP section in `~/.codex/AGENTS.md` instructing Codex to call `acp_check` before non-Bash tool invocations
4. **Pairs this machine via device code** (RFC 8628): you approve a short code in a browser you're already signed into, and the script itself writes the key — nothing is pasted. If the device-code endpoint is unreachable, it falls back to the browser page + a manual one-liner.
5. **Saves the key to `~/.acp/credentials`** (mode 0600). If the install ends with no usable key, it says so loudly and exits with code 2 — hooks without a key are a silent no-op, and the script refuses to call that success.
6. **Installs the cost-X-ray wrapper(s)** (`~/.acp/bin`) for whichever clients are detected, and adds one marked PATH line (`# acp-installer`) to your shell rc:
   - Claude Code: `claude-acp` — routes model calls through the ACP proxy via `ANTHROPIC_BASE_URL` + a custom header; plain `claude` is untouched
   - Codex: `codex-acp` — adds a `[model_providers.acp]` block to `~/.codex/config.toml` (never changes the file's default `model_provider`) and launches with `codex -c model_provider=acp`; plain `codex` is untouched

In **`--local` mode**, steps 4–6 and every other piece of cloud wiring are skipped entirely: no OAuth, no MCP server, no cost wrapper, no shell-rc edits. Hooks + the on-device engine only. (Codex note: its hooks cover shell commands today; non-Bash Codex tools aren't hookable yet — in cloud mode the MCP connector covers them.)

The installer is **idempotent**: running it again upgrades existing entries in place without duplicating them or touching unrelated hooks/policies you've configured.

## Trust signals

- **Source**: [`install.sh`](install.sh) — one self-contained script, read it top-to-bottom
- **SHA-256**: [`https://agenticcontrolplane.com/install.sh.sha256`](https://agenticcontrolplane.com/install.sh.sha256) — auto-updates on every Agentic Control Plane release
- **License**: MIT
- **Dry read**: `curl -sf https://agenticcontrolplane.com/install.sh | less`
- **Commit history**: every change is here in this repo

### Source of truth

**This repo is the canonical source of `install.sh`.** The copy served at `agenticcontrolplane.com/install.sh` (and any copy embedded in the marketing-site repo) is a **mirror** — it must be synced from this repo, never hand-edited. If the served script ever differs from `install.sh` here, that is a bug: the daily [mirror-drift check](.github/workflows/mirror-drift.yml) fails loudly until they match again. Fixes land here first, then propagate to the site.

## What this script will NOT do

- Run any non-interactive commands without prompting if creds already exist (it asks "Reconfigure? (y/N)")
- Install to directories you don't own (`$HOME/.acp/`, `$HOME/.codex/`, `$HOME/.claude/`, `$HOME/.cursor/` only)
- Phone home to any server other than `api.agenticcontrolplane.com` and (during auth) `cloud.agenticcontrolplane.com` — **and in `--local` mode, nothing leaves your machine at all** (decisions run on-device from `~/.acp/decide.mjs` + `~/.acp/policy.json`; no network calls)
- Modify anything outside the client config files documented above (cloud mode adds exactly one marked PATH line to your shell rc for `claude-acp`; local mode touches no rc files)
- Install binaries or compile anything — it's a pure shell + Node.js script

## Uninstall

```bash
# Remove the ACP directory (credentials + govern.mjs)
rm -rf ~/.acp

# Remove the hooks from each detected client's config:
# - ~/.claude/settings.json        remove the "govern.mjs" entries under hooks.PreToolUse[] and hooks.PostToolUse[]
# - ~/.cursor/hooks.json           remove the "govern.mjs" entries under hooks.preToolUse[] and hooks.postToolUse[]
# - ~/.codex/hooks.json            remove the "govern.mjs" entries under hooks.PreToolUse[] and hooks.PostToolUse[]
# - ~/.codex/config.toml           remove the [mcp_servers.acp] block, the [model_providers.acp] block, and the [features] hooks line (hooks = true, or codex_hooks = true on older builds)
# - ~/.codex/AGENTS.md             remove the block between <!-- acp:begin --> and <!-- acp:end --> markers
# - ~/.zshrc / ~/.bashrc           remove the PATH line marked "# acp-installer" (cloud mode only)
```

A one-line `uninstall.sh` is planned. Until then, the blocks above are small enough to remove by hand.

## Reporting issues

- **Install broke something**: open an issue here → [github.com/agentic-control-plane/acp-install/issues](https://github.com/agentic-control-plane/acp-install/issues)
- **Governance behavior questions**: [agenticcontrolplane.com/faq](https://agenticcontrolplane.com/faq)
- **Integration details per client**: [agenticcontrolplane.com/integrations](https://agenticcontrolplane.com/integrations)

## License

MIT — see [LICENSE](LICENSE).

Not a coding-agent CLI? Framework agents use [acp-governance-sdks](https://github.com/agentic-control-plane/acp-governance-sdks); Hermes Agent uses [hermes-acp-plugin](https://github.com/agentic-control-plane/hermes-acp-plugin) (`pip install hermes-acp`).
