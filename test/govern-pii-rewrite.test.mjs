// The embedded govern.mjs fallback hook: rewrite capabilities per client,
// applying the gateway's modified_input / modified_tool_response through the
// client's own field, and never claiming removal it did not perform. Mirrors
// the canonical plugin hook's behaviour for the clients this fallback serves
// (Claude Code, qwen-code); every other client declares nothing.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADDR = ["jane.doe", "acme-corp.dev"].join("@");

function extractGovern() {
  const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
  const m = sh.match(/cat > "\$(?:GOVERN_BUNDLED|CONFIG_DIR\/govern\.mjs)" << 'GOVERN'\n([\s\S]*?)\nGOVERN\n/);
  assert.ok(m, "could not find the embedded govern.mjs heredoc in install.sh");
  return m[1] + "\n";
}

let server, base;
let nextResponse = {};
let lastBody = null;

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { lastBody = JSON.parse(raw); } catch { lastBody = null; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(nextResponse));
    });
  });
  const LOOPBACK = [127, 0, 0, 1].join(".");
  await new Promise((r) => server.listen(0, LOOPBACK, r));
  base = `http://${LOOPBACK}:${server.address().port}`;
});
after(() => server.close());

const CLIENTS = {
  claude: {},
  qwen: { ACP_CLIENT: "qwen-code" },
  cursor: { ACP_CLIENT: "cursor" },
  codex: { ACP_CLIENT: "codex", ACP_HARNESS: "codex" },
  copilot: { ACP_CLIENT: "copilot", ACP_HARNESS: "copilot" },
};
const ORIG = { stdout: `mail ${ADDR}`, stderr: "", interrupted: false, isImage: false };

function run(event, client, response, toolResponse = ORIG) {
  nextResponse = response;
  const home = mkdtempSync(join(tmpdir(), "acp-pii-fallback-"));
  mkdirSync(join(home, ".acp"), { recursive: true });
  const hook = join(home, ".acp", "govern.mjs");
  writeFileSync(hook, extractGovern());
  const env = { ...process.env, HOME: home, ACP_BEARER_TOKEN: "test-token", ACP_API_BASE: base, ACP_LOCAL: "", ...CLIENTS[client] };
  if (!CLIENTS[client].ACP_CLIENT) delete env.ACP_CLIENT;
  if (!CLIENTS[client].ACP_HARNESS) delete env.ACP_HARNESS;
  const payload = {
    tool_name: "Bash", tool_input: { command: "cat people.txt" }, hook_event_name: event, session_id: "s-pii",
    ...(event === "PostToolUse" ? { tool_response: toolResponse, tool_output: "x" } : {}),
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => status === 0
      ? resolve({ out: stdout ? JSON.parse(stdout) : null, body: lastBody })
      : reject(new Error(`govern.mjs exited ${status}: ${stderr}`)));
    child.stdin.end(JSON.stringify(payload));
  });
}

const LINE = "[ACP] Redacted 1 email address from this result.";
const PII = { types: ["email"], count: 1, action: "redacted", applied: true };
const MOD_IN = { command: "cat people.txt | sed s/x/[REDACTED:email]/" };
const MOD_OUT = { stdout: "mail [REDACTED:email]", stderr: "", interrupted: false, isImage: false };

test("capabilities per client (Pre and Post)", async () => {
  const pre = { claude: ["input_rewrite"], qwen: ["input_rewrite"], cursor: [], codex: [], copilot: [] };
  const post = { claude: ["input_rewrite", "output_rewrite"], qwen: ["input_rewrite"], cursor: [], codex: [], copilot: [] };
  for (const c of Object.keys(CLIENTS)) {
    assert.deepEqual((await run("PreToolUse", c, { decision: "allow" })).body.capabilities, pre[c], `pre ${c}`);
    const p = await run("PostToolUse", c, { action: "pass" });
    assert.deepEqual(p.body.capabilities, post[c], `post ${c}`);
    assert.deepEqual(p.body.tool_response, ORIG);
  }
});

test("Pre: Claude Code and qwen-code apply modified_input as updatedInput + allow", async () => {
  for (const c of ["claude", "qwen"]) {
    const { out } = await run("PreToolUse", c, { decision: "allow", modified_input: MOD_IN, pii: PII, notice: LINE });
    assert.equal(out.hookSpecificOutput.permissionDecision, "allow", c);
    assert.deepEqual(out.hookSpecificOutput.updatedInput, MOD_IN, c);
    assert.equal(out.systemMessage, LINE, c);
  }
});

test("Pre: undeclared clients apply nothing and claim no removal; malformed input fails open", async () => {
  for (const c of ["cursor", "codex", "copilot"]) {
    const { out } = await run("PreToolUse", c, { decision: "allow", modified_input: MOD_IN, pii: PII, notice: LINE });
    assert.equal(out.hookSpecificOutput, undefined, c);
    assert.equal(out.systemMessage, "[ACP] PII flagged: email", c);
  }
  const { out } = await run("PreToolUse", "claude", { decision: "allow", modified_input: { command: 1 }, pii: PII, notice: LINE });
  assert.equal(out.hookSpecificOutput, undefined);
  assert.equal(out.systemMessage, "[ACP] PII flagged: email");
});

test("Post: Claude Code gets updatedToolOutput in the original shape", async () => {
  const { out } = await run("PostToolUse", "claude", { action: "redact", pii: PII, notice: LINE, modified_tool_response: MOD_OUT });
  assert.deepEqual(out.hookSpecificOutput, { hookEventName: "PostToolUse", updatedToolOutput: MOD_OUT });
  assert.equal(out.systemMessage, LINE);
  const arr = [{ type: "text", text: "c [REDACTED:email]" }];
  const a = await run("PostToolUse", "claude", { action: "redact", pii: PII, notice: LINE, modified_tool_response: arr }, [{ type: "text", text: `c ${ADDR}` }]);
  assert.deepEqual(a.out.hookSpecificOutput.updatedToolOutput, arr);
});

test("Post: a schema-mismatched rewrite is dropped and no removal is claimed", async () => {
  for (const bad of [{ stdout: "x" }, "mail [REDACTED:email]", { ...MOD_OUT, interrupted: "no" }]) {
    const { out } = await run("PostToolUse", "claude", { action: "redact", pii: PII, notice: LINE, modified_tool_response: bad });
    assert.equal(out.hookSpecificOutput, undefined);
    assert.equal(out.systemMessage, "[ACP] PII flagged: email");
  }
});

test("Post: no output rewrite for qwen-code, Codex, Cursor, Copilot", async () => {
  for (const c of ["qwen", "codex", "cursor", "copilot"]) {
    const { out } = await run("PostToolUse", c, { action: "redact", pii: PII, notice: LINE, modified_tool_response: MOD_OUT });
    assert.equal(out.hookSpecificOutput, undefined, c);
    assert.equal(out.systemMessage, "[ACP] PII flagged: email", c);
  }
});

test("old gateway (no pii field): neutral flagged line, never a removal claim", async () => {
  const { out } = await run("PostToolUse", "claude", { action: "redact", reason: "redacted PII: email, phone" });
  assert.equal(out.systemMessage, "[ACP] PII flagged: email, phone");
  assert.equal(out.hookSpecificOutput, undefined);
});

test("block is unchanged", async () => {
  const { out } = await run("PostToolUse", "claude", { action: "block", reason: "prompt-injection detected" });
  assert.match(out.systemMessage, /^\[ACP\] Blocked: prompt-injection detected/);
});
