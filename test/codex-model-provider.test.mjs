// [model_providers.acp] wiring for Codex's cost X-ray (mirrors claude-acp,
// but for Codex: a separate model provider block plus an opt-in launcher,
// rather than touching Codex's default model_provider).
//
// Extracts the exact shell snippet install.sh uses to write the block (the
// bytes users get — same approach as the other extract-and-run tests in this
// directory) and asserts:
//   - the block content matches the published copy from
//     agenticcontrolplane.com/blog/codex-cli-cost-tracking and
//     /integrations/codex (both agree on this block)
//   - running it twice against the same config.toml inserts the block once
//     (idempotency — the actual product bug this test exists to catch)
//   - it never writes a top-level `model_provider = "acp"` default — the
//     installer must not silently switch what plain `codex` uses
//   - the codex-acp wrapper opts a single invocation in via `-c
//     model_provider=acp` instead

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_SH = readFileSync(join(ROOT, "install.sh"), "utf8");

function extractProviderBlockSnippet() {
  const m = INSTALL_SH.match(
    /if \[ "\$LOCAL_MODE" = false \] && ! grep -q "\^\\\[model_providers\\\.acp\\\]" "\$CODEX_TOML"; then\n([\s\S]*?\nPROVIDERBLOCK\n)  fi\n/,
  );
  assert.ok(m, "could not find the [model_providers.acp] writer block in install.sh");
  return `if [ "$LOCAL_MODE" = false ] && ! grep -q "^\\[model_providers\\.acp\\]" "$CODEX_TOML"; then\n${m[1]}fi\n`;
}

function extractProviderTomlBody() {
  const m = INSTALL_SH.match(/cat >> "\$CODEX_TOML" << 'PROVIDERBLOCK'\n\n([\s\S]*?)\nPROVIDERBLOCK\n/);
  assert.ok(m, "could not find the PROVIDERBLOCK heredoc body in install.sh");
  return m[1];
}

test("[model_providers.acp] block matches the published copy (cost-tracking post + /integrations/codex)", () => {
  const body = extractProviderTomlBody();
  assert.equal(
    body,
    [
      '[model_providers.acp]',
      'name = "Agentic Control Plane"',
      'base_url = "https://api.agenticcontrolplane.com/openai/v1"',
      "requires_openai_auth = true",
      'wire_api = "responses"',
      'env_http_headers = { "x-acp-key" = "ACP_KEY" }',
    ].join("\n"),
  );
});

test("writing the block twice inserts it once (idempotent)", () => {
  const snippet = extractProviderBlockSnippet();
  const dir = mkdtempSync(join(tmpdir(), "acp-codex-toml-"));
  const tomlPath = join(dir, "config.toml");
  try {
    // install.sh always `touch`es config.toml into existence before this
    // step runs (Step 1c, above the extracted snippet) — match that so the
    // extracted snippet sees the same starting state real users get.
    writeFileSync(tomlPath, "");
    execFileSync("/bin/sh", ["-c", snippet], {
      env: { ...process.env, LOCAL_MODE: "false", CODEX_TOML: tomlPath },
    });
    execFileSync("/bin/sh", ["-c", snippet], {
      env: { ...process.env, LOCAL_MODE: "false", CODEX_TOML: tomlPath },
    });
    const src = readFileSync(tomlPath, "utf8");
    const occurrences = (src.match(/\[model_providers\.acp\]/g) ?? []).length;
    assert.equal(occurrences, 1, `expected exactly one [model_providers.acp] block after running the writer twice, got ${occurrences}:\n${src}`);
    assert.match(src, /base_url = "https:\/\/api\.agenticcontrolplane\.com\/openai\/v1"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writing the block onto an existing config.toml preserves unrelated content", () => {
  const snippet = extractProviderBlockSnippet();
  const dir = mkdtempSync(join(tmpdir(), "acp-codex-toml-"));
  const tomlPath = join(dir, "config.toml");
  try {
    writeFileSync(tomlPath, '[features]\nhooks = true\n\n[mcp_servers.acp]\ncommand = "sh"\n');
    execFileSync("/bin/sh", ["-c", snippet], {
      env: { ...process.env, LOCAL_MODE: "false", CODEX_TOML: tomlPath },
    });
    const src = readFileSync(tomlPath, "utf8");
    assert.match(src, /\[features\]\nhooks = true/, "existing [features] block was disturbed");
    assert.match(src, /\[mcp_servers\.acp\]/, "existing [mcp_servers.acp] block was disturbed");
    assert.match(src, /\[model_providers\.acp\]/, "expected [model_providers.acp] block to be appended");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--local mode never writes the block", () => {
  const snippet = extractProviderBlockSnippet();
  const dir = mkdtempSync(join(tmpdir(), "acp-codex-toml-"));
  const tomlPath = join(dir, "config.toml");
  try {
    execFileSync("/bin/sh", ["-c", snippet], {
      env: { ...process.env, LOCAL_MODE: "true", CODEX_TOML: tomlPath },
    });
    let src = "";
    try {
      src = readFileSync(tomlPath, "utf8");
    } catch {
      // file never created — also fine, also proves nothing was written.
    }
    assert.doesNotMatch(src, /\[model_providers\.acp\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installer never sets model_provider as the config.toml default (plain `codex` stays untouched)", () => {
  // The installer must only ever ADD the [model_providers.acp] table, never
  // a top-level `model_provider = "..."` key selecting it by default —
  // that's codex-acp's job, per-invocation, via -c.
  const codexSection = INSTALL_SH.slice(INSTALL_SH.indexOf('# ── Step 1c: Codex CLI setup'), INSTALL_SH.indexOf('# ── Step 1d: OpenClaw setup'));
  assert.doesNotMatch(
    codexSection,
    /^\s*model_provider\s*=\s*"acp"/m,
    "installer must not write a top-level model_provider default — only codex-acp should select it, per-invocation",
  );
});

test("codex-acp wrapper opts in via `-c model_provider=acp` (verified CLI flag: codex --help -> -c, --config <key=value>)", () => {
  const m = INSTALL_SH.match(/cat > "\$CONFIG_DIR\/bin\/codex-acp" << 'CODEXWRAPPER'\n([\s\S]*?)\nCODEXWRAPPER\n/);
  assert.ok(m, "could not find the codex-acp wrapper heredoc in install.sh");
  const wrapper = m[1];
  assert.match(wrapper, /codex -c model_provider=acp "\$@"/);
  assert.match(wrapper, /exec codex "\$@"/, "must fall back to plain codex when no ACP credentials exist");
  assert.match(
    wrapper,
    /acp-session-summary" codex_cli/,
    "codex-acp should pass a codex-specific clientName prefix to acp-session-summary, not the claude-c default",
  );
});

test("acp-session-summary filters by the caller's clientName prefix, defaulting to claude-c", () => {
  const m = INSTALL_SH.match(/cat > "\$CONFIG_DIR\/bin\/acp-session-summary" << 'SUMMARY'\n([\s\S]*?)\nSUMMARY\n/);
  assert.ok(m, "could not find the acp-session-summary heredoc in install.sh");
  const summary = m[1];
  assert.match(summary, /process\.argv\[1\] \|\| "claude-c"/);
  assert.match(summary, /"\$\{1:-claude-c\}"/);
});

test("end-of-run summary mentions codex-acp alongside plain codex, symmetric with claude-acp", () => {
  assert.match(
    INSTALL_SH,
    /echo "  Codex — two ways to run:"\n\s*echo "    codex        tool calls governed \+ audited \(hooks\)"\n\s*echo "    codex-acp    the above PLUS every model call priced/,
    "expected the final summary's HAS_CODEX branch to advertise codex-acp",
  );
});
