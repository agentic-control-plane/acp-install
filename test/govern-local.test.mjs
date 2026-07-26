// End-to-end tests for the LOCAL path of the embedded govern.mjs dispatcher.
//
// Extracts govern.mjs from install.sh's heredoc (the exact bytes users get),
// runs it as a child process with a throwaway HOME, and asserts the two
// contracts that matter most:
//   1. working engine → a floored command is denied AND audited
//   2. missing engine → fail-open is LOUD (UNGOVERNED message) AND audited —
//      never a silent allow (#498).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function extractGovern() {
  const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
  const m = sh.match(/cat > "\$CONFIG_DIR\/govern\.mjs" << 'GOVERN'\n([\s\S]*?)\nGOVERN\n/);
  assert.ok(m, "could not find the embedded govern.mjs heredoc in install.sh");
  return m[1] + "\n";
}

/** Set up a fake HOME with ~/.acp/{govern.mjs,policy.json}; optionally the engine. */
function setupHome({ withEngine }) {
  const home = mkdtempSync(join(tmpdir(), "acp-local-test-"));
  const acp = join(home, ".acp");
  mkdirSync(acp);
  writeFileSync(join(acp, "govern.mjs"), extractGovern());
  writeFileSync(join(acp, "policy.json"), JSON.stringify({ default: "allow", rules: {} }));
  if (withEngine) copyFileSync(join(ROOT, "decide.mjs"), join(acp, "decide.mjs"));
  return { home, acp };
}

function runHook(home, payload) {
  const res = spawnSync(process.execPath, [join(home, ".acp", "govern.mjs")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HOME: home, ACP_BEARER_TOKEN: "", ACP_LOCAL: "1" },
    timeout: 10_000,
  });
  assert.equal(res.status, 0, `govern.mjs exited ${res.status}: ${res.stderr}`);
  return res.stdout;
}

const RM = "r" + "m";
const preToolUse = (command) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
});

test("local path: working engine denies a floored command and audits it", () => {
  const { home, acp } = setupHome({ withEngine: true });
  const out = runHook(home, preToolUse([RM, "-rf", "~"].join(" ")));
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  const audit = readFileSync(join(acp, "audit.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(audit.at(-1).decision, "deny");
  assert.equal(audit.at(-1).source, "hardline");
});

test("local path: missing engine fails open LOUDLY and audits it (never silent)", () => {
  const { home, acp } = setupHome({ withEngine: false });
  const out = runHook(home, preToolUse("echo hi"));
  assert.match(out, /UNGOVERNED/, "fail-open must carry a loud UNGOVERNED systemMessage");
  assert.doesNotMatch(out, /"permissionDecision"/, "engine failure must not deny (never brick)");
  const audit = readFileSync(join(acp, "audit.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(audit.at(-1).source, "fail-open");
  assert.equal(audit.at(-1).decision, "allow");
});
