# Harness canary

`.github/workflows/harness-canary.yml` proves, every 6 hours and with nobody
watching, that the live ACP installer still governs the **current released**
Claude Code, Codex and opencode. Each matrix leg, on a fresh `ubuntu-latest`
runner with Node 22:

1. `npm i -g` the harness at `@latest` and prints the resolved version.
2. Seeds `~/.acp/credentials` from `ACP_CANARY_KEY`, then runs
   `curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --only=<harness>`.
   With no TTY, `--only` selects the harness non-interactively and the seeded
   key makes the installer's Step 2 (Authenticate) keep the existing key and
   exit 0 — no device flow, no prompt (`ACP_RECONFIGURE` is left unset).
3. Asserts the install invariants (`scripts/canary-assert.mjs invariants`):
   Claude Code is governed exactly once (the ACP plugin is listed by
   `claude plugin list` and `settings.json` carries no direct govern hook, or,
   on a CLI without plugin support, `settings.json` has the hook exactly once
   in PreToolUse and PostToolUse); `~/.codex/config.toml` has `[model_providers.acp]` exactly once
   and `~/.codex/hooks.json` has the govern hook once; `opencode.json` lists
   the `acp-opencode` plugin exactly once. Each `<harness>-acp` launcher exists.
4. Pushes one governed call with a unique marker `acp-canary-<run id>-<harness>`:
   - `~/.acp/bin/claude-acp -p "Run exactly: echo <marker>" --model haiku --allowedTools "Bash(echo:*)"`
   - `~/.acp/bin/codex-acp exec --full-auto --skip-git-repo-check "Run exactly: echo <marker>"`
   - `~/.acp/bin/opencode-acp run "Run exactly: echo <marker>"`
5. Polls `GET /admin/audit?since=<install time>` for up to 120 s
   (`scripts/canary-assert.mjs audit`) for a shell/echo row from this
   harness's client string. The audit API returns no argument preview, so the
   marker is matched in the harness transcript, and the audit row is matched
   on time window + client + tool. The canary workspace is dedicated, so the
   window is specific.
6. Always runs `scripts/canary-report.mjs`: on failure, files or updates one
   issue per harness in `davidcrowe/gatewaystack-connect` (labels `canary`,
   `harness:<id>`, body marker `<!-- harness-canary:<id> -->`); on success,
   comments and closes any open one.

Triggers: `schedule: 13 */6 * * *`, `workflow_dispatch` (input `harness`:
all | claude-code | codex | opencode), and `repository_dispatch` type
`harness-release` (optional `client_payload.harness`). Concurrency is per
harness; legs do not cancel each other.

## Secrets (repository secrets on agentic-control-plane/acp-install)

| Secret | Used by | Notes |
| --- | --- | --- |
| `ACP_CANARY_KEY` | all legs | API key of the **canary workspace**. Must carry the `admin.audit.read` scope (the audit read is the same `/admin/audit` endpoint agentgovbench uses). It is also the key the hooks and launchers use, so it is the identity every canary audit row is written under. |
| `ANTHROPIC_API_KEY` | claude-code | BYO key forwarded through the ACP proxy by `claude-acp`. Use a low-limit key; the call is one `haiku` turn. |
| `OPENAI_API_KEY` | codex | Required: the installer's `[model_providers.acp]` block sets `requires_openai_auth = true`, so `codex-acp exec` needs OpenAI auth even though traffic rides the ACP proxy. Low-limit key. |
| `CANARY_ISSUES_TOKEN` | reporter | Fine-grained PAT, repository `davidcrowe/gatewaystack-connect`, permission **Issues: read and write** only. Creating the `canary` / `harness:*` labels on first use needs that same permission. |

Required repository **variable** (not secret): `ACP_CANARY_TENANT_SLUG` — the
canary workspace's slug. Production is multi-tenant, so the audit read is
`GET https://api.agenticcontrolplane.com/<slug>/admin/audit`; a bare
`/admin/audit` answers `Unknown tenant slug: admin` (verified 2026-10-07).

The opencode leg needs no provider secret: `opencode-acp` selects
`acp/gemini-3.5-flash`, billed to the canary workspace through the proxy.

## Which workspace, and the flag it MUST carry

Use a dedicated workspace (suggested slug `acp-canary`) created for this
purpose, with a key minted only for it. Do not reuse a founder or customer
workspace: every run writes audit rows and model spend there.

**The canary workspace must be flagged internal**, or every 6-hour run counts
as external activation/retention in the /platform funnel. In
`gatewaystack-connect` the population filter is
`isInternalTenant()` (`apps/tenant-gateway/src/platform/shared.ts`), which
checks the tenant document itself:

```
tenants/<tenantId>  { internal: true, internalKind: "canary" }
```

`internal: true` is the load-bearing field; `internalKind` is the label
(`canary` keeps it distinct from `test` / `benchmark` / `demo`). Set it on the
tenant doc before the first scheduled run.

## What cannot be verified from the repo alone

- `opencode-acp` passes `--model acp/<id>` before the `run` subcommand; the
  installer only checks `opencode --help` for `--model`. If the released
  opencode rejects a global `--model`, that leg fails at `governed-call` and
  the issue says so. The installer also sets `permission.bash = "ask"` in
  `opencode.json`; headless `opencode run` relies on the `acp-opencode`
  plugin to answer that ask.
- The opencode plugin's client string is owned by the `acp-opencode` npm
  package; the audit match for that leg is `/opencode/i`.
- Codex hooks depend on the released Codex honouring `~/.codex/hooks.json`
  (the installer picks the `hooks` / `codex_hooks` feature flag itself).

## Running the reporter locally

```
node scripts/canary-report.mjs --harness codex --status failure --version 0.0.0 \
  --run-url https://example.invalid/run --failed-step governed-call --dry-run
```
