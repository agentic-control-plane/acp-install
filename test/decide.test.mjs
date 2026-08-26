// Fixture tests for the LOCAL decision engine (decide.mjs).
//
// The safety floor is the single most-trusted promise the installer makes
// ("nothing can cross it") — a promise that was broken once by ordinary
// command shapes (sudo -u, timeout N, nice -n, git -C, subshells — #19).
// These fixtures pin the floor's coverage on the common phrasings of each
// catastrophe — including the flag orderings, spellings, and wrapper/grouping
// launders an agent actually emits — so a well-meaning refactor can't quietly
// reopen a hole. They also pin that every key the default policy ships is
// reachable by the classifier (a rule that never fires is worse than no rule).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { classifyTool, hardlineFloor, candidates, decide } from "../decide.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const bash = (command) => ["Bash", { command }];

// ── Safety floor: MUST deny (assembled from parts so this file never contains
//    a literal runnable catastrophe). ──────────────────────────────────────
const RM = "r" + "m";
const push = (...rest) => ["git", "push", ...rest].join(" ");

const FLOOR_DENY = [
  // force-push to main — every natural phrasing
  push("--force", "origin", "main"),
  push("origin", "main", "--force"),      // flags after the refspec
  push("-f", "origin", "main"),           // short flag
  push("origin", "+main"),                // + refspec force
  push("--force-with-lease", "origin", "master"),
  // recursive force-delete — combined, split, long, trailing slash, sudo
  [RM, "-rf", "/"].join(" "),
  [RM, "-rf", "~"].join(" "),
  [RM, "-rf", "~/"].join(" "),            // trailing slash
  [RM, "-r", "-f", "/"].join(" "),        // split flags
  [RM, "--recursive", "--force", "/"].join(" "), // long flags
  ["sudo", RM, "-rf", "/"].join(" "),
  ["echo hi &&", RM, "-rf", "~"].join(" "), // compound
  // other catastrophes
  "mkfs.ext4 /dev/sda1",
  "dd if=/dev/zero of=/dev/sda bs=1M",
  "chmod -R 777 /",
  // laundering through another interpreter
  ['bash -c "', RM, '-rf ~"'].join(" "),          // bash -c " rm -rf ~"
  ["sh -lc '", RM, "-rf /'"].join(" "),           // sh -lc, single quotes
  ["eval", RM, "-rf", "~"].join(" "),             // eval, bare
  ['eval "', RM, '-rf ~"'].join(" "),             // eval, quoted
  ['bash -c "echo ok &&', RM, '-rf ~"'].join(" "),// compound inside -c
  ["bash", "-c", `"${push("-f", "origin", "main")}"`].join(" "),
  // $HOME spellings
  [RM, "-rf", "$HOME"].join(" "),
  [RM, "-rf", "${HOME}"].join(" "),
  // wrapper operands, option-arguments, and grouping (#19)
  ["sudo", "-u", "root", RM, "-rf", "/"].join(" "),   // sudo's -u USER operand
  ["timeout", "5", RM, "-rf", "~"].join(" "),         // timeout's DURATION operand
  ["nice", "-n", "10", RM, "-rf", "/"].join(" "),     // nice's -n N operand
  ["nohup", "timeout", "2", RM, "-rf", "/"].join(" "),// stacked wrappers
  "git -C . push --force origin main",                // option-argument before subcommand
  ["(", RM, "-rf", "/", ")"].join(" "),               // subshell
  ["{", RM, "-rf", "/;", "}"].join(" "),              // brace group
  ["fish -c '", RM, "-rf /'"].join(" "),              // fish joins SHELL_BINS
  ["echo ok $(", RM, "-rf ~ )"].join(" "),            // command substitution
  [RM, "-rf", "/."].join(" "),                        // /. spelling of root
];

for (const cmd of FLOOR_DENY) {
  test(`floor denies: ${cmd}`, () => {
    assert.equal(hardlineFloor(...bash(cmd)) !== null, true, `expected floor to deny: ${cmd}`);
    assert.equal(decide(...bash(cmd), { default: "allow", rules: {} }).decision, "deny");
  });
}

// ── Safety floor: MUST NOT deny (legitimate look-alikes). ──────────────────
const FLOOR_ALLOW = [
  push("origin", "feature-branch"),       // push, not to main
  push("origin", "main"),                 // push to main WITHOUT force is fine
  [RM, "-rf", "node_modules"].join(" "),  // recursive force on a safe target
  [RM, "file.txt"].join(" "),
  "git status",
  "git commit -m wip",
  "ls -la /",
  "bash -c 'echo hi'",                    // -c with a benign command
  "bash ./scripts/build.sh",              // running a script is not -c
  "git commit -m 'eval cleanup'",         // interpreter words inside a message
  "timeout 30 npm test",                  // wrapped, but benign
  "sudo -u postgres psql -c 'select 1'",  // -u operand consumed, psql is fine
  "nice -n 10 make build",
  "git -C /repo status",
  "npm run lint && npm test",             // compound, but benign
];

for (const cmd of FLOOR_ALLOW) {
  test(`floor allows: ${cmd}`, () => {
    assert.equal(hardlineFloor(...bash(cmd)), null, `floor should NOT fire on: ${cmd}`);
  });
}

// ── Classifier: subcommand granularity so git.push is governable alone. ─────
test("classifyTool gives git subcommand granularity", () => {
  assert.equal(classifyTool(...bash("git push origin main")), "Bash.git.push");
  assert.equal(classifyTool(...bash("git status")), "Bash.git.status");
  assert.equal(classifyTool(...bash("git push --force origin main")), "Bash.git.push");
});

test("classifyTool: curl carries host, plain bins stay bare", () => {
  assert.equal(classifyTool(...bash("curl https://api.github.com/x")), "Bash.curl.api.github.com");
  assert.equal(classifyTool(...bash("rm -rf foo")), "Bash.rm");
  assert.equal(classifyTool("Write", { file_path: "a.ts" }), "Write");
  assert.equal(classifyTool("WebFetch", { url: "https://www.example.com/p" }), "WebFetch.example.com");
});

test("classifyTool unwraps wrapper operands and option-arguments (#19)", () => {
  assert.equal(classifyTool(...bash("sudo -u root chmod 777 f")), "Bash.chmod");
  assert.equal(classifyTool(...bash("timeout 5 npm test")), "Bash.npm.test");
  assert.equal(classifyTool(...bash("nice -n 10 git push origin dev")), "Bash.git.push");
  assert.equal(classifyTool(...bash("git -C /repo push origin dev")), "Bash.git.push"); // was the malformed "Bash.git.."
});

test("compound commands classify by most-privileged segment; every segment is policy-checked (#18)", () => {
  assert.equal(classifyTool(...bash("which gcloud && gcloud sql instances delete x --quiet")), "Bash.gcloud.sql");
  assert.equal(classifyTool(...bash("true && chmod 777 /tmp/demo")), "Bash.chmod");
  const policy = { default: "allow", rules: { "Bash.gcloud": "deny", ["Bash." + RM]: "deny", "Bash.curl": "ask" } };
  assert.equal(decide(...bash("which gcloud && gcloud sql instances delete x --quiet"), policy).decision, "deny");
  assert.equal(decide(...bash(["true &&", RM, "-rf", "/tmp/demo"].join(" ")), policy).decision, "deny");
  assert.equal(decide(...bash("echo hi && curl https://x.com"), policy).decision, "ask"); // strictest matched rule wins
  assert.equal(decide(...bash("npm run lint && npm test"), policy).decision, "allow");    // benign compound stays allow
});

test("unparseable non-empty commands are Bash.unknown, never a wrong-segment key", () => {
  assert.equal(classifyTool(...bash(") ) )")), "Bash.unknown"); // still governable; falls back to Bash in the walk
  assert.equal(classifyTool(...bash("")), "Bash");
});

// ── Every default-policy key must be reachable by the classifier. ───────────
test("default policy ships no dead rules", () => {
  const policy = JSON.parse(readFileSync(join(ROOT, "policy.default.json"), "utf8"));
  const sampleCmds = [
    "rm -rf foo", "curl https://x.com", "git push origin main",
    "chmod 755 f", "chown me f", "git status", "npm install",
  ];
  const reachable = new Set(sampleCmds.flatMap((c) => candidates(classifyTool(...bash(c)))));
  for (const key of Object.keys(policy.rules)) {
    assert.equal(reachable.has(key), true, `dead policy rule — classifier never emits a candidate matching "${key}"`);
  }
});

// ── decide(): policy walk + precedence. ─────────────────────────────────────
test("decide walks most-specific → least and honors default", () => {
  const policy = { default: "allow", rules: { "Bash.git.push": "deny", "Bash.curl": "ask" } };
  assert.equal(decide(...bash("git push origin main --force"), policy).decision, "deny"); // floor first
  assert.equal(decide(...bash("git push origin feature"), policy).decision, "deny");      // policy Bash.git.push
  assert.equal(decide(...bash("curl https://api.github.com"), policy).decision, "ask");   // walk to Bash.curl
  assert.equal(decide(...bash("echo hi"), policy).decision, "allow");                     // default
});
