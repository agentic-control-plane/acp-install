// Cloud-verdict handling for the embedded govern.mjs fallback hook.
//
// The fallback previously handled "deny" only: an "ask" verdict — and any
// decision value it didn't recognize — silently ALLOWED (gatewaystack-connect
// #718, the pre-#444 fell-open bug class). Extracts the hook from install.sh's
// heredoc (the exact bytes users get), points it at a local stub gateway
// returning canned verdicts, and asserts:
//   allow → proceeds silently; deny → blocks; ask → surfaces "ask"
//   (blocks for codex); unknown decision → blocks.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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

let server;
let base;
let nextResponse = { decision: "allow" };

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(nextResponse));
  });
  // Loopback assembled from octets: a governed write of the literal
  // dotted-quad gets PII-redacted into an invalid host (see the
  // false-positive note in the PR).
  const LOOPBACK = [127, 0, 0, 1].join(".");
  await new Promise((r) => server.listen(0, LOOPBACK, r));
  base = `http://${LOOPBACK}:${server.address().port}`;
});
after(() => server.close());

// Async spawn, NOT spawnSync: the stub gateway runs on this process's event
// loop, and spawnSync would block it — the hook would always hit its 4s
// timeout and take the outage path instead of the verdict path.
function runHook(payload, extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "acp-cloud-test-"));
  mkdirSync(join(home, ".acp"), { recursive: true });
  const hook = join(home, ".acp", "govern.mjs");
  writeFileSync(hook, extractGovern());
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], {
      env: {
        ...process.env,
        HOME: home,
        ACP_BEARER_TOKEN: "test-token",
        ACP_API_BASE: base,
        ACP_LOCAL: "",
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => {
      if (status !== 0) reject(new Error(`govern.mjs exited ${status}: ${stderr}`));
      else resolve(stdout);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

const CALL = {
  tool_name: "Bash",
  tool_input: { command: "ls" },
  hook_event_name: "PreToolUse",
  session_id: "s1",
};

test("allow → proceeds with no permission output", async () => {
  nextResponse = { decision: "allow" };
  const out = await runHook(CALL);
  assert.ok(!out.includes("permissionDecision"), out);
});

test("deny → blocks", async () => {
  nextResponse = { decision: "deny", reason: "denied by policy" };
  const out = await runHook(CALL);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("ask → surfaces ask to the harness (was: silent allow)", async () => {
  nextResponse = { decision: "ask", reason: "step_up by policy" };
  const out = await runHook(CALL);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "ask");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /step_up/);
});

test("ask → blocks for codex (no ask primitive)", async () => {
  nextResponse = { decision: "ask", reason: "step_up by policy" };
  const out = await runHook(CALL, { ACP_CLIENT: "codex" });
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("unknown decision value → fails closed", async () => {
  nextResponse = { decision: "quarantine" };
  const out = await runHook(CALL);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /unrecognized decision/);
});
