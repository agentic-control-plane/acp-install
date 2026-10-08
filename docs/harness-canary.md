# Harness canary

`.github/workflows/harness-canary.yml` proves, every 6 hours and with nobody
watching, that the live ACP installer still wires into the **current
released** build of every harness the installer supports headless, and that
every published ACP SDK still gets a governance decision from the gateway.
Where a harness can run headless on a model that needs no vendor key, the
leg also pushes one governed call and asserts the audit row landed.

## Coverage

| Leg | Install | Live call or invariants | Why |
| --- | --- | --- | --- |
| `claude-code` | `npm i -g @anthropic-ai/claude-code@latest` | **Live**: `claude-acp -p "Run exactly: echo <marker>" --allowedTools "Bash(echo:*)"` with `CLAUDE_CODE_OAUTH_TOKEN` (a `claude setup-token` subscription token), then the audit-row assert. | The proxy forwards a BYO subscription OAuth bearer verbatim when the request carries a well-formed `x-acp-key` (`apps/tenant-gateway/src/proxy/anthropicNative.ts`, `byoAnthropicCredential`: `Authorization: Bearer <non-gsk>` + `x-acp-key` -> upstream `authorization`; the Anthropic SDK path uses `authToken`). `claude-acp` sets exactly that header, so the OAuth token goes **through the proxy**, is metered as `byoAuth: true`, and no `ANTHROPIC_API_KEY` exists anywhere in the job. Model spend bills the subscription, not the canary workspace. |
| `codex` | `npm i -g @openai/codex@latest` | Invariants | `[model_providers.acp]` sets `requires_openai_auth = true`, so `codex-acp exec` needs a real `OPENAI_API_KEY`; the canary carries no vendor key by decision. |
| `opencode` | `npm i -g opencode-ai@latest` | **Live**: `opencode-acp run`, `acp/gemini-3.5-flash` through the proxy. | No vendor key: the launcher selects the `acp` provider on the seeded key. |
| `qwen-code` | `npm i -g @qwen-code/qwen-code@latest` | **Live**: `qwen-acp -p`, `OPENAI_BASE_URL` -> proxy, `gemini-3.5-flash`. | The launcher prices a launch only when Qwen's auth type is `openai`, so the seed step writes `security.auth.selectedType = "openai"` to `~/.qwen/settings.json` before the installer merges its hooks (an invariant checks it survived). Headless `ask` resolves to deny by Qwen's own rule; a rejection in the transcript fails the step with the audit rows dumped (gsc#1380 classification). |
| `pi` | `npm i -g @earendil-works/pi-coding-agent@latest` | **Live**: `pi-acp -p`, `--model acp/gemini-3.5-flash` from the `acp` provider in `models.json`. | No vendor key; pi resolves the key from `!cat ~/.acp/credentials`. |
| `prime-agent` | `npm i -g prime-agent@latest` | **Live** (expected red): `prime-acp -p`, `ACP_PROXY=1`, `acp/gemini-3.5-flash`. | Upstream was rewritten in Rust (gsc#1378); the npm name may no longer resolve and the extension contract may have moved. The leg is kept so it **fails and reports** rather than hiding the drift. |
| `grok` | `npm i -g @xai-org/grok-build@latest` | Invariants | `grok-acp -m acp` would reach the proxy on Gemini, but Grok Build's headless entrypoint and flags were not verifiable from this repo; promote to live once the `-p`-style invocation is confirmed. |
| `dsh` | `npm i -g deepseek-harness@latest` | Invariants | `dsh` has no `--model` flag: the `acp` provider is selected per profile, and a fresh install has no profile to point at the proxy. |
| `hermes` | `pipx install hermes-agent` (Python 3.12) | Invariants | `hermes-acp` prices only Anthropic-native backends (via `ANTHROPIC_BASE_URL`, workspace-billed Anthropic, which is not Gemini); an OpenAI-compatible backend needs `acp-hermes proxy-setup` plus a configured model. |
| `openclaw` | `npm i -g openclaw@latest` | Invariants | OpenClaw is a long-lived gateway daemon; the model endpoint is persistent config, not a per-launch choice. |
| `muse` | `npm i -g muse-code@latest` | Invariants | No way to redirect Muse Code's model traffic to an external base URL; tool governance only. |
| `sdk-governance-js` | `npm i @agenticcontrolplane/governance@latest` | **Live**: `preToolUse("shell", { command: "echo <marker>" })` under `withContext({ userToken })`, then the audit-row assert. | `scripts/canary-sdk-governance-js.mjs`; a fail-open lapse (cause in the reason) is a FAIL. |
| `sdk-governance-anthropic` | `npm i @agenticcontrolplane/governance-anthropic@latest` | **Live**: `governHandlers({ shell })` dispatch, then the audit-row assert. | `scripts/canary-sdk-governance-anthropic.mjs`; an `UNGOVERNED` warning is a FAIL. |
| `sdk-proxy` | `npm i @agenticcontrolplane/proxy@latest` | One `acpFetch` to GitHub through ACP's egress (no audit-row step). | `scripts/canary-sdk-proxy.mjs`: connected, not-connected and policy-denied all prove the egress answered with the canary identity; 401 and unreachable fail. The package has no tool-call shape. |
| `sdk-governance-py` | `pip install acp-governance` | **Live**: `pre_tool_use("shell", {...})` after `set_context(user_token=key)`, then the audit-row assert. | `scripts/canary-sdk-governance-py.py` via `canary_sdk_common.py`. |
| `sdk-langchain` | `pip install acp-langchain` | **Live**: adapter import + `ACPMiddleware()` + the same protocol call. | The middleware's wrap hooks need a model run, so they are not driven. |
| `sdk-pydantic-ai` | `pip install acp-pydantic-ai` | **Live**: adapter import + `ACPHooks()` + the same protocol call. | Same limit as langchain. |
| `sdk-crewai` | `pip install acp-crewai` | **Live**: adapter import + `install_crew_hooks` exported + the same protocol call. | Same limit. |

Not in the matrix: **Cursor** (needs `cursor-agent` login / API key), **Copilot
CLI** (needs a GitHub account with a Copilot seat), **Antigravity** (GUI IDE +
Google sign-in) — issues are filed in `davidcrowe/gatewaystack-connect` with
what each would need. **fx** is not an installer target (`_offer` list), so it
has no leg.

Package names: `@qwen-code/qwen-code`, `@earendil-works/pi-coding-agent` and
`openclaw` were taken from the harness repos / a local install. The names for
`prime-agent`, `@xai-org/grok-build`, `deepseek-harness`, `hermes-agent` and
`muse-code` could **not** be verified when the legs were written (the registry
lookups were refused in that session): a wrong name shows up as
`install-harness` red on the first run and the leg's issue says so. Fix the
name in the workflow; do not drop the leg.

## What each harness leg does

Each matrix leg, on a fresh `ubuntu-latest` runner with Node 22 (and Python
3.12 for hermes):

1. Installs the harness at `@latest` and prints the resolved version.
2. Seeds `~/.acp/credentials` from `ACP_CANARY_KEY` (plus the Qwen auth-type
   seed above), then runs
   `curl -sf https://agenticcontrolplane.com/install.sh | bash -s -- --only=<harness>`.
   With no TTY, `--only` selects the harness non-interactively and the seeded
   key makes the installer's Step 2 (Authenticate) keep the existing key and
   exit 0: no device flow, no prompt (`ACP_RECONFIGURE` is left unset).
3. Asserts the install invariants (`scripts/canary-assert.mjs invariants`):
   the hook / plugin / provider is wired **exactly once**, the `<harness>-acp`
   launcher is executable, the agent directive (`acp:begin` ... `acp:end`) is
   in the harness's instructions file exactly once, and no harness config
   file carries a `gsk_` key literal. Per harness: Claude Code plugin listed
   (or direct hook once); Codex `[model_providers.acp]` once + `hooks.json`
   once; opencode plugin once + `acp` provider; Qwen hooks once + openai auth
   type; pi `extensions/acp.ts` + `models.json` provider (`baseUrl`, not
   `baseURL`); Prime `acp.ts` + `acp-proxy.ts` gated on `ACP_PROXY`; Grok
   `hooks/acp.json` + `[model.acp]` once with `env_key`; dsh provider once via
   `apiKeyEnv`; Hermes `hermes plugins list` shows `acp`; OpenClaw
   `settings.json` runs `govern.mjs` once per event; Muse `muse plugins list`
   shows `acp`. **Invariants-only legs end here.**
4. (live legs) Pushes one governed call with a unique marker
   `acp-canary-<run id>-<harness>` through the launcher (commands in the
   table). The step **fails** if the transcript contains a rejection
   (`auto-rejecting`, `rejected permission`, `Denied at approval`,
   `permission denied`, `requires approval`): that is gsc#1380 (a headless
   harness rejecting the governed call), and the leg goes red with the
   transcript attached rather than passing silently. On that failure the step
   prints every audit row in the window with its `decision`
   (`scripts/canary-assert.mjs rows`) so #1380 can be classified:
   `decision=allow` means the plugin/harness permission contract drifted;
   `decision=ask` means the gateway is asking in audit mode.
5. (live legs; runs even when step 4 failed, so its log is attached) Polls
   `GET /<slug>/admin/audit?since=<install time>` for up to 120 s
   (`scripts/canary-assert.mjs audit`) for a shell/echo row from this leg's
   client prefix. The audit API returns no argument preview, so the marker is
   matched in the transcript and the row on time window + client prefix +
   tool. **Legs run concurrently against one workspace**, so every live leg
   needs a client prefix no other leg produces (`CLIENT_MATCH` in
   `canary-assert.mjs`; the SDK scripts set `acp-canary-sdk-<leg>/<version>`
   as their client header for exactly this reason).
6. Always runs `scripts/canary-report.mjs`: on failure, files or updates one
   issue per leg in `davidcrowe/gatewaystack-connect` (labels `canary`,
   `harness:<id>`, body marker `<!-- harness-canary:<id> -->`). The reporter
   step builds the step list **per leg** (live harness legs:
   install-harness, seed-credentials, install-acp, install-invariants,
   governed-call, audit-row; invariants-only legs stop at
   install-invariants; SDK legs: install-package, run-check, audit-row, the
   proxy leg without audit-row) and reports `success` only when **every**
   step on that list has `outcome=success`; a skipped or cancelled step is
   not green and can never close an open issue. The first non-success step
   is the reported failing step; governed-call and audit-row failures attach
   `canary-run.log,canary-audit.log`.

The SDK job (`sdk`) runs the same shape without the installer: install the
published package, run `scripts/canary-sdk-<name>.(mjs|py)`, assert the row.
The Node scripts are copied into the install directory before running
because ESM resolution ignores `NODE_PATH`.

No `--dangerously-*` flag is used anywhere in the canary.

Triggers: `schedule: 13 */6 * * *`, `workflow_dispatch` (input `harness`:
`all` | `harnesses` | `sdks` | one leg id), and `repository_dispatch` type
`harness-release` (optional `client_payload.harness`, same values).
Concurrency is per leg; legs do not cancel each other.

### Drift sweep (how a drift issue gets resolved)

The drift scout (gatewaystack-connect, `apps/tenant-gateway/src/drift/`,
`docs/drift-scout.md` there) files **one issue per upstream release** in
`davidcrowe/gatewaystack-connect` when a release signal (npm latest, GitHub
release/tag, PyPI) of a harness or SDK moves: label `drift`, body marker
`<!-- drift-scout:key=release:<entryId>@<version> -->`. It does not trigger
the canary. **The scheduled canary resolves matching drift issues within
~6 h; no extra token.** Each leg installs `@latest`, so by the next scheduled
run it is testing exactly the version the scout saw.

After every leg reports, `scripts/canary-report.mjs` lists the open `drift`
issues, keeps the ones whose release marker names a registry entry mapped to
this leg (`LEG_ENTRIES` in the script mirrors `canaryLeg` in the scout's
`registry.ts`: `claude-code`, `codex`, `opencode`, `qwen-code`, `pi`,
`prime-agent`, `grok`, `dsh`, `hermes`, `openclaw`, `muse` map to the leg of
the same name; `crewai` to `sdk-crewai`; `langchain-core` and `langgraph` to
`sdk-langchain`; `anthropic-sdk-typescript` to `sdk-governance-anthropic`)
and whose normalised version (first dotted number, the scout's
`normalizeVersion` rule, so `v1.1.0`, `rust-v1.1.0`, `1.1.0 (Claude Code)`
all read `1.1.0`) equals the version this run tested, and posts the verdict:

- pass: `Canary <leg> on <version>: ✅ passed — closing.` and closes the
  issue (`state_reason: completed`);
- fail: `Canary <leg> on <version>: ❌ failed at <step>: <canary issue or
  run link>`, once per failure: when the reporter's last verdict comment on
  that issue already says failed for the same version, a later red run on
  the same version does not repeat it.

Docs-type drift issues (markers that are not `release:`) are left alone: a
green canary says nothing about a changed docs page. For harness legs the
tested version is the harness's own `--version` output. For SDK legs the
`--version` is the ACP package's, so the `install-package` step also records
the upstream versions it installed (`langchain-core`, `langgraph`, `crewai`,
`@anthropic-ai/sdk`) and passes them as `--tested entryId=version,...`; an
SDK entry with no recorded version is skipped. The sweep is best effort: a
failure there is logged and never fails the reporter, so the canary issue
stays the primary record. `CANARY_ISSUES_TOKEN` covers it (same repo,
Issues: read and write).

Dispatch pairing is kept for hand-triggered runs: a `repository_dispatch`
`harness-release` with `client_payload`
`{harness, drift_issue, version, drift_kind: "release"|"docs", close_on_pass}`
reaches the reporter as `--drift-issue`, `--drift-version`, `--drift-kind`,
`--drift-close`, and the verdict is posted on that issue (closed on pass for
`release` drift unless `close_on_pass: false`); the sweep skips that issue
so it is not commented twice.

Preview the sweep locally with a fixture (`{drift: [...], canary: [...],
comments: [...]}` is what dry-run `GET`s return):

```
node scripts/canary-report.mjs --harness qwen-code --status success --version "0.9.0 (Qwen Code)" \
  --run-url https://example.invalid/run --dry-run --fixture fixture.json
```

## Secrets (repository secrets on agentic-control-plane/acp-install)

| Secret | Used by | Notes |
| --- | --- | --- |
| `ACP_CANARY_KEY` | all legs | API key of the **canary workspace**. Must carry the `admin.audit.read` scope (the audit read is the same `/admin/audit` endpoint agentgovbench uses). It is also the key the hooks, launchers and SDK scripts use, so it is the identity every canary audit row is written under. |
| `CLAUDE_CODE_OAUTH_TOKEN` | claude-code | A `claude setup-token` subscription token. Exposed to the `governed-call` step of the claude-code leg only (the workflow expression leaves it empty for every other leg). Never an `ANTHROPIC_API_KEY`. |
| `CANARY_ISSUES_TOKEN` | reporter | Fine-grained PAT, repository `davidcrowe/gatewaystack-connect`, permission **Issues: read and write** only. Creating the `canary` / `harness:*` labels on first use needs that same permission. |

No vendor model keys. Codex stays invariants-only for that reason: the
installer's `[model_providers.acp]` block sets `requires_openai_auth = true`,
so `codex-acp exec` needs a real `OPENAI_API_KEY` (a placeholder gets a 401
from OpenAI, not from ACP), and headless `codex exec` no longer accepts
`--full-auto`.

Required repository **variable** (not secret): `ACP_CANARY_TENANT_SLUG`, the
canary workspace's slug. Production is multi-tenant, so the audit read is
`GET https://api.agenticcontrolplane.com/<slug>/admin/audit`; a bare
`/admin/audit` answers `Unknown tenant slug: admin` (verified 2026-10-07).

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

- The unverified package names listed under Coverage.
- `opencode-acp` passes `--model acp/<id>` before the `run` subcommand; the
  installer only checks `opencode --help` for `--model`. If the released
  opencode rejects a global `--model`, that leg fails at `governed-call` and
  the issue says so. The installer also sets `permission.bash = "ask"` in
  `opencode.json`; headless `opencode run` auto-rejects an unanswered ask, so
  the canary pre-approves `echo *` via `OPENCODE_CONFIG_CONTENT` for its own
  process (see the opencode row under the failure table). That means the leg
  proves the plugin's audit row, not the `permission.ask` allow path.
- Headless `-p` on qwen-code, pi and prime-agent runs the shell call only if
  the hook's `allow` is honoured as the permission decision; if the harness
  still asks, the transcript shows the rejection and the leg goes red with
  the audit rows dumped. That is the intended signal, not a flake.
- Client strings for the pi / prime / grok / dsh / hermes / openclaw / muse
  plugins are owned by their plugin packages; the prefixes in `CLIENT_MATCH`
  are best guesses for the legs that are not live today and must be checked
  before any of them is promoted to live.
- Whether the released Codex honours `~/.codex/hooks.json`, and whether the
  released Claude Code fires the plugin hook, is exercised only by a live
  leg: claude-code now is, codex is not.
- `@agenticcontrolplane/proxy` is present in the SDK monorepo as a built
  `dist/` only; if it is not published, its leg fails at `install-package`.

## Running the reporter and the SDK scripts locally

```
node scripts/canary-report.mjs --harness codex --status failure --version 0.0.0 \
  --run-url https://example.invalid/run --failed-step governed-call --dry-run

cd "$(mktemp -d)" && npm init -y >/dev/null && npm i @agenticcontrolplane/governance@latest \
  && cp <repo>/scripts/canary-sdk-governance-js.mjs . \
  && ACP_CANARY_KEY=gsk_... MARKER=local-test node canary-sdk-governance-js.mjs

pip install acp-governance && ACP_CANARY_KEY=gsk_... python scripts/canary-sdk-governance-py.py
```

## Triage of the first full run (37692378153, 2026-10-07)

What each red leg actually was, and what changed in the canary. Rows not
listed here (codex, sdk-crewai, sdk-governance-py, sdk-governance-js,
sdk-pydantic-ai) were green.

| Leg | Actual error | Class | Canary change |
|---|---|---|---|
| `dsh` | `npm i -g deepseek-harness` installed an unrelated package; no `dsh` binary. | wrong package name | `@deepseek-ai/dsh` (verified with `npm view`). |
| `pi` | Installer: "No supported AI clients detected". `install.sh` detects pi by `~/.pi/agent` (or `pi` on PATH **and** `~/.pi`); a fresh npm install creates neither. | canary env | `mkdir -p ~/.pi/agent` after the install (same trick as muse). |
| `prime-agent` | `prime-agent@latest` is 404 on npm; upstream is a Rust binary now (gsc#1378). | upstream not installable here | Dispatch-only (out of the scheduled set) until the install path is known; `~/.prime/agent` is created for when it is. |
| `grok` | `@xai-org/grok-build@latest` is 404; the plugin repo never names the harness package. | unverifiable name | Dispatch-only. |
| `muse` | `muse-code@latest` is 404; Muse Code 0.2.1 ships as a binary. | unverifiable name | Dispatch-only. |
| `openclaw` | `openclaw@2026.9.8` refuses Node 22 (engines `>=24.16.0 <25 \|\| >=26.1.0`). | canary env | Node 24 for this leg only. |
| `hermes` | Installer exit 23. `install.sh` greps `pipx list` for `package hermes`, which matches `hermes-agent`, then runs `pipx inject hermes ...` against a venv that is named `hermes-agent`; the shebang fallback has no pip (pipx venvs ship without it). | **installer bug** (`install.sh`, the hermes block around `pipx inject hermes acp-hermes`) | None: the leg is right to be red until the installer injects into `hermes-agent`. |
| `claude-code` | Anthropic answered `401 authentication_error: Invalid bearer token` through the BYO path. The proxy forwards `Authorization: Bearer` and `anthropic-beta` verbatim (`apps/tenant-gateway/src/proxy/anthropicNative.ts`), so this is the `CLAUDE_CODE_OAUTH_TOKEN` secret itself. | secret | None: re-mint with `claude setup-token` and update the secret. |
| `qwen-code` | `qwen-acp -p` ran for the full 300 s (exit 124) printing `ACP write error: write EPIPE` from qwen-code's own `packages/cli/src/acp-integration` (Zed Agent Client Protocol transport); audit showed Read/Grep/agent/tool_search rows but never the `echo`. | upstream / product (reproduce in a sandbox) | None yet; gsc#1399 holds the log. |
| `opencode` | "permission requested: bash (echo ...); auto-rejecting" / "The user rejected permission to use this specific tool call" in headless `run` (opencode 1.18.35). The installer writes `permission.bash = "ask"` for attended users; `run` has no one to answer it and auto-rejects, even though the gateway row for the call was `allow`. | canary env (gsc#1380) | The leg sets `OPENCODE_CONFIG_CONTENT='{"permission":{"bash":{"echo *":"allow"}}}'` for that one process only; the installer's `opencode.json` is untouched. |
| `sdk-langchain` | `ACPMiddleware` imports `langchain.agents.middleware`; the leg installed only `acp-langchain`. | canary env | `pip install acp-langchain 'langchain>=1.3.3'`. |
| `sdk-governance-anthropic` | `getConfig` is not exported by `@agenticcontrolplane/governance-anthropic@0.2.1` (it re-exports `governed`, `withContext`, `configure`, `getContext`). | canary script | Version from the package manifest, base URL from env. |
| `sdk-proxy` | `@agenticcontrolplane/proxy` is 404 on npm and not in the SDK monorepo tree. | unpublished | Out of the scheduled set until it is published. |

Issue volume: this one run filed 12 issues in davidcrowe/gatewaystack-connect
(#1388 to #1399, one per leg, labels `canary` + `harness:<leg>`) on top of
#1380. One issue per leg is the dedupe unit, so a first run of a new matrix
is always the loudest; the dispatch-only set above is what keeps the
scheduled run from re-filing on names it cannot resolve.
