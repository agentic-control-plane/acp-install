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
  vscode: { ACP_CLIENT: "copilot-vscode" },
};
const MCP = "mcp__crm__send_note";
const MCP_IN = { to: "crm", note: `call ${ADDR}` };
const MCP_MOD_IN = { to: "crm", note: "call [REDACTED:email]" };
const ORIG = { stdout: `mail ${ADDR}`, stderr: "", interrupted: false, isImage: false };

function run(event, client, response, { tool = "Bash", toolInput = { command: "cat people.txt" }, toolResponse = ORIG } = {}) {
  nextResponse = response;
  const home = mkdtempSync(join(tmpdir(), "acp-pii-fallback-"));
  mkdirSync(join(home, ".acp"), { recursive: true });
  const hook = join(home, ".acp", "govern.mjs");
  writeFileSync(hook, extractGovern());
  const env = { ...process.env, HOME: home, ACP_BEARER_TOKEN: "test-token", ACP_API_BASE: base, ACP_LOCAL: "", ...CLIENTS[client] };
  if (!CLIENTS[client].ACP_CLIENT) delete env.ACP_CLIENT;
  if (!CLIENTS[client].ACP_HARNESS) delete env.ACP_HARNESS;
  const payload = {
    tool_name: tool, tool_input: toolInput, hook_event_name: event, session_id: "s-pii",
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
const NEUTRAL = "[ACP] PII flagged: email";
const MOD_OUT = { stdout: "mail [REDACTED:email]", stderr: "", interrupted: false, isImage: false };
const pre = (extra) => ({ decision: "allow", pii: PII, notice: LINE, ...extra });

test("Pre capabilities: input_rewrite only for outside-party tools, per client", async () => {
  const want = { claude: ["input_rewrite"], qwen: ["input_rewrite"], cursor: [], codex: [], copilot: [], vscode: [] };
  for (const [c, caps] of Object.entries(want)) {
    assert.deepEqual((await run("PreToolUse", c, { decision: "allow" }, { tool: MCP, toolInput: MCP_IN })).body.capabilities, caps, c);
  }
  for (const tool of ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Glob", "Grep"]) {
    assert.deepEqual((await run("PreToolUse", "claude", { decision: "allow" }, { tool, toolInput: { command: "x" } })).body.capabilities, [], tool);
  }
});

test("a VS Code tool id reaching the fallback via Claude settings declares nothing", async () => {
  const { body } = await run("PreToolUse", "claude", { decision: "allow" }, { tool: "run_in_terminal", toolInput: { command: "ls" } });
  assert.deepEqual(body.capabilities, []);
});

test("Post capabilities: output_rewrite only for proven shapes on Claude Code; never input_rewrite", async () => {
  const p = await run("PostToolUse", "claude", { action: "pass" });
  assert.deepEqual(p.body.capabilities, ["output_rewrite"]);
  assert.deepEqual(p.body.tool_response, ORIG);
  const img = await run("PostToolUse", "claude", { action: "pass" }, { tool: "Read", toolResponse: { type: "image", file: { base64: "A" } } });
  assert.deepEqual(img.body.capabilities, []);
  for (const c of ["qwen", "cursor", "codex", "copilot", "vscode"]) {
    assert.deepEqual((await run("PostToolUse", c, { action: "pass" })).body.capabilities, [], c);
  }
  const big = await run("PostToolUse", "claude", { action: "pass" }, { toolResponse: { ...ORIG, stdout: "x".repeat(300 * 1024) } });
  assert.equal(big.body.tool_response, undefined);
  assert.deepEqual(big.body.capabilities, []);
});

test("Pre: updatedInput is applied with NO permissionDecision (merge, same keys)", async () => {
  for (const c of ["claude", "qwen"]) {
    const { out } = await run("PreToolUse", c, pre({ modified_input: MCP_MOD_IN }), { tool: MCP, toolInput: MCP_IN });
    assert.deepEqual(out.hookSpecificOutput.updatedInput, MCP_MOD_IN, c);
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined, c);
    assert.equal(out.systemMessage, LINE, c);
  }
  for (const bad of [{ to: "crm" }, { ...MCP_MOD_IN, extra: 1 }, { to: "crm", note: 5 }]) {
    const { out } = await run("PreToolUse", "claude", pre({ modified_input: bad }), { tool: MCP, toolInput: MCP_IN });
    assert.equal(out.hookSpecificOutput, undefined);
    assert.equal(out.systemMessage, NEUTRAL);
  }
});

test("Pre: Bash is never rewritten; undeclared clients apply nothing and claim no removal", async () => {
  const b = await run("PreToolUse", "claude", pre({ modified_input: { command: "echo" } }));
  assert.equal(b.out.hookSpecificOutput, undefined);
  assert.equal(b.out.systemMessage, NEUTRAL);
  for (const c of ["cursor", "codex", "copilot", "vscode"]) {
    const { out } = await run("PreToolUse", c, pre({ modified_input: MCP_MOD_IN }), { tool: MCP, toolInput: MCP_IN });
    assert.equal(out.hookSpecificOutput, undefined, c);
    assert.equal(out.systemMessage, NEUTRAL, c);
  }
});

test("Pre: a throwing PII line never becomes an outage deny", async () => {
  const { out } = await run("PreToolUse", "claude", { decision: "allow", pii: { types: [{ toString() { throw new Error("x"); } }], action: "redacted" }, notice: { bad: 1 } });
  assert.ok(!out || !JSON.stringify(out).includes("deny"));
});

test("Post: Claude Code gets updatedToolOutput in the original shape (deep)", async () => {
  const { out } = await run("PostToolUse", "claude", { action: "redact", pii: PII, notice: LINE, modified_tool_response: MOD_OUT });
  assert.deepEqual(out.hookSpecificOutput, { hookEventName: "PostToolUse", updatedToolOutput: MOD_OUT });
  assert.equal(out.systemMessage, LINE);
  const arr = [{ type: "text", text: "c [REDACTED:email]" }];
  const a = await run("PostToolUse", "claude", { action: "redact", pii: PII, notice: LINE, modified_tool_response: arr }, { tool: MCP, toolResponse: [{ type: "text", text: `c ${ADDR}` }] });
  assert.deepEqual(a.out.hookSpecificOutput.updatedToolOutput, arr);
});

test("Post: a mismatch at any depth is dropped and no removal is claimed", async () => {
  for (const bad of [{ stdout: "x" }, "mail", { ...MOD_OUT, interrupted: "no" }, { ...MOD_OUT, extra: {} }]) {
    const { out } = await run("PostToolUse", "claude", { action: "redact", pii: PII, notice: LINE, modified_tool_response: bad });
    assert.equal(out.hookSpecificOutput, undefined);
    assert.equal(out.systemMessage, NEUTRAL);
  }
  for (const bad of [[{ type: "text", text: 7 }], [{ type: "text" }], []]) {
    const { out } = await run("PostToolUse", "claude", { action: "redact", pii: PII, notice: LINE, modified_tool_response: bad }, { tool: MCP, toolResponse: [{ type: "text", text: `c ${ADDR}` }] });
    assert.equal(out.hookSpecificOutput, undefined, JSON.stringify(bad));
  }
});

test("Post: no output rewrite for qwen-code, Codex, Cursor, Copilot, VS Code", async () => {
  for (const c of ["qwen", "codex", "cursor", "copilot", "vscode"]) {
    const { out } = await run("PostToolUse", c, { action: "redact", pii: PII, notice: LINE, modified_tool_response: MOD_OUT });
    assert.equal(out.hookSpecificOutput, undefined, c);
    assert.equal(out.systemMessage, NEUTRAL, c);
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
