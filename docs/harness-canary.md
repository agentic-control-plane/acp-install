# Harness canary

`.github/workflows/harness-canary.yml` proves, every 6 hours and with nobody
watching, that the live ACP installer still wires into the **current
released** Claude Code, Codex and opencode, and (opencode only) that a
governed call lands in the audit log. Model calls use **only Gemini** through
ACP's proxy on the platform key: no Anthropic or OpenAI key is held by the
canary, so the claude-code and codex legs stop at the install invariants.
Each matrix leg, on a fresh `ubuntu-latest` runner with Node 22:

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
   **The claude-code and codex legs end here.**
4. (opencode only) Pushes one governed call with a unique marker
   `acp-canary-<run id>-<harness>`:
   `~/.acp/bin/opencode-acp run "Run exactly: echo <marker>"`. The launcher
   selects `acp/gemini-3.5-flash`, so the model call is billed to the canary
   workspace through the proxy and needs no vendor key. The step **fails** if
   the transcript contains `auto-rejecting` or `rejected permission`: that is
   gsc#1380 (headless opencode rejecting the governed call), and the leg must
   go red with the transcript attached rather than pass silently. On that
   failure the step prints every audit row in the window with its `decision`
   (`scripts/canary-assert.mjs rows`) so #1380 can be classified:
   `decision=allow` means the plugin/opencode permission contract drifted;
   `decision=ask` means the gateway is asking in audit mode.
5. (opencode only; runs even when step 4 failed, so its log is attached)
   Polls `GET /admin/audit?since=<install time>` for up to 120 s
   (`scripts/canary-assert.mjs audit`) for a shell/echo row from this
   harness's client string. The audit API returns no argument preview, so the
   marker is matched in the harness transcript, and the audit row is matched
   on time window + client prefix + tool (`client` comes back as
   `{ name, version }`, e.g. `opencode-plugin/0.4.0`, so the match is on the
   prefix). The canary workspace is dedicated, so the window is specific. On
   FAIL it prints every row seen in the window with its `decision`.
6. Always runs `scripts/canary-report.mjs`: on failure, files or updates one
   issue per harness in `davidcrowe/gatewaystack-connect` (labels `canary`,
   `harness:<id>`, body marker `<!-- harness-canary:<id> -->`). The reporter
   step builds the step list **per harness** (opencode: install-harness,
   seed-credentials, install-acp, install-invariants, governed-call,
   audit-row; the other two stop at install-invariants) and reports
   `success` only when **every** step on that list has `outcome=success`; a
   skipped or cancelled step is not green and can never close an open issue.
   The first non-success step is the reported failing step; governed-call and
   audit-row failures attach `canary-run.log,canary-audit.log`.

Live legs for claude-code and codex (one `claude-acp -p` / `codex-acp exec`
turn plus the same audit assert) can be added later if the canary is given
vendor keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`); they are deliberately
absent today. No `--dangerously-*` flag is used anywhere in the canary.

Triggers: `schedule: 13 */6 * * *`, `workflow_dispatch` (input `harness`:
all | claude-code | codex | opencode), and `repository_dispatch` type
`harness-release` (optional `client_payload.harness`). Concurrency is per
harness; legs do not cancel each other.

## Secrets (repository secrets on agentic-control-plane/acp-install)

| Secret | Used by | Notes |
| --- | --- | --- |
| `ACP_CANARY_KEY` | all legs | API key of the **canary workspace**. Must carry the `admin.audit.read` scope (the audit read is the same `/admin/audit` endpoint agentgovbench uses). It is also the key the hooks and launchers use, so it is the identity every canary audit row is written under. |
| `CANARY_ISSUES_TOKEN` | reporter | Fine-grained PAT, repository `davidcrowe/gatewaystack-connect`, permission **Issues: read and write** only. Creating the `canary` / `harness:*` labels on first use needs that same permission. |

No vendor model keys. If live legs are added later for claude-code / codex,
note what was learned: `claude-acp` forwards a BYO `ANTHROPIC_API_KEY` through
the proxy and the key's org must hold credit (Anthropic's "credit balance is
too low" comes back as an `is_error` result); the installer's
`[model_providers.acp]` block sets `requires_openai_auth = true`, so
`codex-acp exec` needs a real `OPENAI_API_KEY` (a placeholder gets a 401 from
OpenAI, not from ACP), and headless `codex exec` no longer accepts
`--full-auto`.

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
  (the installer picks the `hooks` / `codex_hooks` feature flag itself). The
  canary only checks the file was written once; whether Codex fires it is not
  exercised without a live leg.
- The claude-code leg likewise proves the plugin/hook is wired once, not that
  the released Claude Code fires it.

## Running the reporter locally

```
node scripts/canary-report.mjs --harness codex --status failure --version 0.0.0 \
  --run-url https://example.invalid/run --failed-step governed-call --dry-run
```
