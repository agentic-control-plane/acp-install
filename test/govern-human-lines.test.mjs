// The embedded govern.mjs fallback hook prints the gateway's human lines.
//
// Until this change the fallback printed only Blocked / Flagged / billing
// warnings. `notice` (audit-mode counterfactual, cost lever, first-day
// receipt) and `upgrade_notice` (stale hook) were dropped, so a workspace
// on Cursor, Codex or Copilot never heard from ACP unless a call was
// blocked. Same extraction as govern-cloud-verdicts.test.mjs: the exact
// bytes users get, against a stub gateway.

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
  const m = sh.match(/cat > "\$(?:GOVERN_BUNDLED|CONFIG_DIR\/govern\.mjs)" << 'GOVERN'\n([\s\S]*?)\nGOVERN\n/);
  assert.ok(m, "could not find the embedded govern.mjs heredoc in install.sh");
  return m[1] + "\n";
}

let server;
let base;
let nextResponse = {};

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(nextResponse));
  });
  const LOOPBACK = [127, 0, 0, 1].join(".");
  await new Promise((r) => server.listen(0, LOOPBACK, r));
  base = `http://${LOOPBACK}:${server.address().port}`;
});
after(() => server.close());

function runHook(payload, extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "acp-lines-test-"));
  mkdirSync(join(home, ".acp"), { recursive: true });
  const hook = join(home, ".acp", "govern.mjs");
  writeFileSync(hook, extractGovern());
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], {
      env: { ...process.env, HOME: home, ACP_BEARER_TOKEN: "test-token", ACP_API_BASE: base, ACP_LOCAL: "", ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => (status === 0 ? resolve(stdout) : reject(new Error(`govern.mjs exited ${status}: ${stderr}`))));
    child.stdin.end(JSON.stringify(payload));
  });
}

const PRE = { tool_name: "Bash", tool_input: { command: "ls" }, hook_event_name: "PreToolUse", session_id: "s1" };
const POST = { tool_name: "Bash", tool_input: { command: "ls" }, tool_output: "ok", hook_event_name: "PostToolUse", session_id: "s1" };

const NOTICE = "[ACP] On. 20 calls checked so far, 0 held. audit — recording, everything else runs";

test("pre allow + notice → the notice is printed on the human channel", async () => {
  nextResponse = { decision: "allow", notice: NOTICE };
  const out = JSON.parse(await runHook(PRE));
  assert.equal(out.systemMessage, NOTICE);
  assert.ok(!out.hookSpecificOutput, "an allowed call carries no permission output");
});

test("pre allow + warning + notice + upgrade_notice → one JSON object, three lines", async () => {
  nextResponse = { decision: "allow", warning: "over plan", notice: NOTICE, upgrade_notice: "[ACP] hook 0.1 is stale — run /acp-upgrade" };
  const raw = await runHook(PRE);
  const out = JSON.parse(raw); // throws if two objects were written
  assert.deepEqual(out.systemMessage.split("\n"), ["⚠ over plan", NOTICE, "[ACP] hook 0.1 is stale — run /acp-upgrade"]);
});

test("pre allow with no lines → stdout stays empty (unchanged behaviour)", async () => {
  nextResponse = { decision: "allow" };
  assert.equal(await runHook(PRE), "");
});

test("pre deny ignores notice: the block line is the only output", async () => {
  nextResponse = { decision: "deny", reason: "denied by policy", notice: NOTICE };
  const out = JSON.parse(await runHook(PRE));
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(!String(out.systemMessage || "").includes("20 calls"));
});

test("post pass + notice → printed", async () => {
  nextResponse = { action: "pass", notice: NOTICE };
  const out = JSON.parse(await runHook(POST));
  assert.equal(out.systemMessage, NOTICE);
});

test("post pass, no notice → stdout stays empty", async () => {
  nextResponse = { action: "pass" };
  assert.equal(await runHook(POST), "");
});

test("post block + notice → block line first, then the notice", async () => {
  nextResponse = { action: "block", reason: "prompt injection", notice: NOTICE };
  const out = JSON.parse(await runHook(POST));
  assert.deepEqual(out.systemMessage.split("\n"), ["[ACP] Blocked: prompt injection", NOTICE]);
});

test("escape sequences and control characters are stripped; blank notices are dropped", async () => {
  nextResponse = { action: "pass", notice: "\u001b[31mred\u001b[0m text\u0007", upgrade_notice: "   " };
  const out = JSON.parse(await runHook(POST));
  assert.equal(out.systemMessage, "red text");
});

test("non-string notice fields are ignored", async () => {
  nextResponse = { action: "pass", notice: { text: "nope" }, upgrade_notice: 7 };
  assert.equal(await runHook(POST), "");
});
