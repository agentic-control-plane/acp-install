# acp-install

One command that puts the same allow / ask / deny rules in front of every coding agent on your machine: Claude Code, Cursor, Codex and the rest. Free for individuals. What each agent enforces differs; the [coverage matrix](https://agenticcontrolplane.com/coverage) has the details.

<p align="center">
  <img src="demo/acp-local-demo.gif" width="820" alt="Real terminal recording: one command installs ACP local mode with no signup. A coding agent's force-push to main is held by the safety floor, a network call has to ask, normal work runs and is logged, and the same policy applies to Codex. tail ~/.acp/audit.jsonl shows every call and its decision.">
</p>
<p align="center"><sub>Recorded from the live installer and the real CLIs. <a href="demo/README.md">How it's made, and how to re-record it</a>. 60&nbsp;seconds: install, agent held, asked, allowed, the audit log.</sub></p>

```bash
curl -sf https://agenticcontrolplane.com/install.sh | bash
```

That connects a workspace (free for individuals) with a shared console and the cost X-ray. If you'd rather keep everything on your machine, with no account, add the flag:

```bash
curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --local
```

Re-run without `--local` any time to connect.

The installer detects whichever agents you run and sets up, for every agent it finds:

- **Safety floor.** `rm -rf /`, `mkfs`, `dd` to a disk and fork bombs are always refused, including quoted and dot-segment spellings of those paths. Force-push, destructive SQL through a database CLI, `curl | sh` and deleting outside the working directory ask first. In a connected interactive install (without `--all` or `--only`) the installer asks "Keep the safety floor on? (Y/n)" and the default is on. Other installs leave it on without asking. An owner or admin can turn the ask tier off later on the Policies page. The always-refused list can't be changed.
- **Your rules, one place.** `allow` / `ask` / `deny` per tool, applied the same way to every agent. They live in the shared console (connected) or in `~/.acp/policy.json` (`--local`).
- **A log of what happened.** The live activity feed in the console, or `tail -f ~/.acp/audit.jsonl` in `--local` mode.

Works on macOS and Linux. On Windows, run `irm https://agenticcontrolplane.com/install.ps1 | iex` in PowerShell (connected install only; `--local` is POSIX-only today). Needs Node (pi and dsh need Node 22, Prime Agent 22.8+) and at least one supported agent: Claude Code, Cursor, OpenAI Codex CLI, GitHub Copilot, OpenClaw, opencode, Qwen Code, pi, Prime Agent, Muse Code, Grok Build, Antigravity, Hermes Agent, DeepSeek Harness. What each one sees, and how a held call reaches you, is in the [coverage matrix](https://agenticcontrolplane.com/coverage).

Want the long version first? [Every file the installer writes, in plain language](https://agenticcontrolplane.com/install-explained) · [getting started](https://agenticcontrolplane.com/getting-started) · per-client guides for [Claude Code](https://agenticcontrolplane.com/integrations/claude-code) and [Codex CLI](https://agenticcontrolplane.com/integrations/codex)

## What the installer does

For whichever AI clients it detects:

1. **Writes `~/.acp/govern.mjs`**, a shared hook dispatcher. It sends every tool call to the ACP governance API and enforces the allow/deny decision locally.
2. **Registers PreToolUse and PostToolUse hooks** in the client's config:
   - Claude Code: `~/.claude/settings.json`
   - Cursor: `~/.cursor/hooks.json`
   - Codex: `~/.codex/hooks.json`
3. **For Codex only,** wires three layers:
   - Enables the hooks feature in `~/.codex/config.toml` (`[features].hooks = true` on Codex 0.145.0+, the deprecated `codex_hooks` alias on older builds).
   - Adds `[mcp_servers.acp]` (the ACP MCP connector, for `acp_check` and hosted tools that never reach a hook), with runtime credential substitution so no API key sits in your dotfiles.
   - Writes an ACP section in `~/.codex/AGENTS.md` telling Codex that the hooks already cover its local tools, so it should not call `acp_check` per tool.
4. **Pairs this machine by device code** (RFC 8628). You approve a short code in a browser you're already signed into, and the script writes the key itself. Nothing is pasted. If the device-code endpoint is unreachable, it falls back to the browser page and a manual one-liner.
5. **Saves the key to `~/.acp/credentials`** (mode 0600). If the install ends with no usable key, it says so and exits with code 2. Hooks without a key do nothing, and the script won't call that success.
6. **Installs the cost X-ray wrappers** in `~/.acp/bin` for whichever clients it found, and adds one marked PATH line (`# acp-installer`) to your shell rc:
   - Claude Code: `claude-acp` routes model calls through the ACP proxy via `ANTHROPIC_BASE_URL` and a custom header. Plain `claude` is untouched.
   - Codex: `codex-acp` adds a `[model_providers.acp]` block to `~/.codex/config.toml` (it never changes the file's default `model_provider`) and launches with `codex -c model_provider=acp`. Plain `codex` is untouched.

In `--local` mode, steps 4 to 6 and all other cloud wiring are skipped: no OAuth, no MCP server, no cost wrapper, no shell-rc edits. You get hooks and the on-device engine only. (Codex hooks match every local tool call: shell, `apply_patch`, MCP and other local tools. Only hosted tools such as web search bypass hooks.)

The installer is idempotent. Running it again upgrades existing entries in place without duplicating them or touching hooks and policies you configured yourself.

## Trust

- **Source:** [`install.sh`](install.sh) is one self-contained script. Read it top to bottom.
- **SHA-256:** [`https://agenticcontrolplane.com/install.sh.sha256`](https://agenticcontrolplane.com/install.sh.sha256), updated on every release.
- **License:** MIT.
- **Read it first:** `curl -sf https://agenticcontrolplane.com/install.sh | less`
- **History:** every change is in this repo.

This repo is the canonical source of `install.sh`. The copy served at `agenticcontrolplane.com/install.sh` (and any copy in the marketing-site repo) is a mirror, synced from here and never hand-edited. If the served script ever differs from the one here, that's a bug. The daily [mirror-drift check](.github/workflows/mirror-drift.yml) fails until they match.

## What it will not do

- Run non-interactively if credentials already exist. It asks "Reconfigure? (y/N)".
- Install to directories you don't own. It writes only to `$HOME/.acp/`, `$HOME/.codex/`, `$HOME/.claude/` and `$HOME/.cursor/` (plus the config paths of other agents you picked).
- Send tool-call data anywhere but ACP's API (`api.agenticcontrolplane.com`, and `cloud.agenticcontrolplane.com` during sign-in). In a connected install it sends one install report to ACP at the end: outcome, exit code, the step that failed, OS and architecture, which agents you chose, and your answer to the floor question. Set `ACP_NO_REPORT=1` to skip it. In `--local` mode no tool-call data leaves your machine; decisions run on-device from `~/.acp/decide.mjs` and `~/.acp/policy.json`. The installer itself downloads hooks and plugins from GitHub, npm and PyPI.
- Change anything outside the client config files above. Cloud mode adds one marked PATH line to your shell rc for `claude-acp`. Local mode touches no rc files.
- Compile anything. It's a shell and Node.js script. For some agents it runs `npm install -g` or `pip install` to fetch their plugin.

## Uninstall

`acp-uninstall` is written to `~/.acp/bin` on every install.

```bash
acp-uninstall --dry-run   # preview what would be removed
acp-uninstall             # remove hook registrations, directive blocks, MCP entries, the PATH line, and ~/.acp
```

It runs from a copy cached in `~/.acp`, so it works offline, and it keeps anything in those config files you wrote yourself. If `~/.acp/bin` isn't on your PATH, or the install predates the cached copy:

```bash
curl -sf https://agenticcontrolplane.com/uninstall.sh | bash
```

## Getting help

- **Install broke or failed:** open an issue at [github.com/agentic-control-plane/acp-install/issues](https://github.com/agentic-control-plane/acp-install/issues), or email [su***************************om](mailto:su***************************om). Include your OS, the agents you run, and the installer output.
- **Behavior questions:** [agenticcontrolplane.com/faq](https://agenticcontrolplane.com/faq)
- **Per-client details:** [agenticcontrolplane.com/integrations](https://agenticcontrolplane.com/integrations)

MIT. See [LICENSE](LICENSE).

Not a coding-agent CLI? Framework agents use [acp-governance-sdks](https://github.com/agentic-control-plane/acp-governance-sdks). Hermes Agent uses [hermes-acp-plugin](https://github.com/agentic-control-plane/hermes-acp-plugin) (`pip install acp-hermes`).
