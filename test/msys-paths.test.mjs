// Git Bash / MSYS2 / Cygwin path guard for install.sh.
//
// Under those shells node is a native Windows program, but $HOME-based paths
// are msys paths (/c/Users/me/...). When the runtime's automatic argv
// conversion does not apply, node resolves /c/Users/... as C:\c\Users\... and
// the claude_code step dies writing ~/.claude/settings.json (seen in install
// reports from MSYS_NT-10.0-26200: step claude_code, "line N: node").
// install.sh routes every path it hands to `node -e` through _acp_np, which
// runs `cygpath -w` on those shells.
//
// These tests run on macOS/Linux: a fake `uname` reports MSYS, a fake
// `cygpath` converts /x/y -> C:\x\y, and a fake `node` behaves like Windows
// node (refuses a POSIX path argument, maps C:\x\y back to /x/y and runs the
// real node). The real windows-latest run is .github/workflows/
// windows-live-install.yml.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SH = readFileSync(join(ROOT, "install.sh"), "utf8");
const LINES = SH.split("\n");

function slice(startRe, endRe) {
  const s = LINES.findIndex((l) => startRe.test(l));
  assert.ok(s !== -1, `start marker ${startRe} not found in install.sh`);
  const e = LINES.findIndex((l, i) => i > s && endRe.test(l));
  assert.ok(e !== -1, `end marker ${endRe} not found in install.sh`);
  return LINES.slice(s, e + 1).join("\n");
}

// The helper (detection + _acp_np) and acp_write_directive, verbatim.
const HELPER = slice(/^_ACP_WINPATHS=false$/, /^}$/);
const DIRECTIVE = slice(/^acp_write_directive\(\) \{$/, /^}$/);

function sandbox(unameOut, { withCygpath = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "acp-msys-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const put = (name, body) => {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  };
  put("uname", `#!/bin/sh\necho '${unameOut}'\n`);
  if (withCygpath) {
    // cygpath -w /a/b/c -> C:\a\b\c
    put("cygpath", `#!/bin/sh\n[ "$1" = "-w" ] || exit 1\nprintf 'C:%s\\n' "$2" | tr '/' '\\\\'\n`);
  }
  // Windows node: an argument that looks like an absolute POSIX path is
  // unopenable (exit 9, like ENOENT on C:\c\Users\...). C:\x\y is mapped
  // back to /x/y so the real node can do the work on this host.
  put(
    "node",
    [
      "#!/bin/bash",
      'args=()',
      'for a in "$@"; do',
      '  case "$a" in',
      '    /*) echo "fake-windows-node: cannot open POSIX path $a" >&2; exit 9 ;;',
      '    C:\\\\*) a="${a#C:}"; a="${a//\\\\//}" ;;',
      '  esac',
      '  args+=("$a")',
      'done',
      `exec "${process.execPath}" "\${args[@]}"`,
      "",
    ].join("\n"),
  );
  return { dir, bin };
}

function run(sb, body) {
  const script = join(sb.dir, "case.sh");
  writeFileSync(script, `#!/bin/bash\nset -e\n${HELPER}\n${DIRECTIVE}\n${body}\n`);
  chmodSync(script, 0o755);
  return spawnSync("/bin/bash", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${sb.bin}:/usr/bin:/bin` },
  });
}

test("_acp_np converts on MSYS, MINGW and CYGWIN", () => {
  for (const u of ["MSYS_NT-10.0-26200", "MINGW64_NT-10.0-26100", "CYGWIN_NT-10.0-19045"]) {
    const sb = sandbox(u);
    try {
      // Every call site uses "$(_acp_np ...)", which strips cygpath's newline.
      const r = run(sb, 'printf "%s" "$(_acp_np /c/Users/runner/.claude/settings.json)"');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "C:\\c\\Users\\runner\\.claude\\settings.json", `uname ${u}`);
    } finally { rmSync(sb.dir, { recursive: true, force: true }); }
  }
});

test("_acp_np leaves paths alone on macOS/Linux and when cygpath is missing", () => {
  for (const [u, opts] of [["Darwin", {}], ["Linux", {}], ["MSYS_NT-10.0-26200", { withCygpath: false }]]) {
    const sb = sandbox(u, opts);
    try {
      const r = run(sb, 'printf "%s" "$(_acp_np /home/me/.claude/settings.json)"');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "/home/me/.claude/settings.json", `uname ${u}`);
    } finally { rmSync(sb.dir, { recursive: true, force: true }); }
  }
});

test("a real node -e site (acp_write_directive) writes through Windows-style node on MSYS", () => {
  const sb = sandbox("MSYS_NT-10.0-26200");
  try {
    const target = join(sb.dir, "home", ".claude", "CLAUDE.md");
    const r = run(sb, `acp_write_directive "${target}" "Claude Code" "~/.acp/bin/claude-acp" claude`);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(target), "CLAUDE.md was not written");
    assert.match(readFileSync(target, "utf8"), /acp:begin/);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});

test("negative control: the same site without conversion fails the way Git Bash did", () => {
  // Detection says "not Windows", so the path reaches node unconverted.
  const sb = sandbox("Darwin");
  try {
    const target = join(sb.dir, "home", ".claude", "CLAUDE.md");
    const r = run(sb, `acp_write_directive "${target}" "Claude Code" "~/.acp/bin/claude-acp" claude`);
    assert.notEqual(r.status, 0, "fake Windows node should have refused the POSIX path");
    assert.match(r.stderr, /cannot open POSIX path/);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});

test("every path argument handed to node -e goes through _acp_np", () => {
  // Argument lines that close a node -e body:   ' "$X" ...   or   " "$X" ...
  const PATHISH = /^(HOME|CLAUDE_SETTINGS|CLAUDE_JSON|QWEN_SETTINGS|COPILOT_HOOKS_DIR|CURSOR_HOOKS|CURSOR_MCP|CODEX_TOML|CODEX_HOOKS|OPENCODE_JSON|PI_MODELS|CREDS_FILE|CONFIG_DIR|_d_file)\b/;
  const bad = [];
  LINES.forEach((l, i) => {
    const m = l.match(/^\s*['"] ("\$.*)$/);
    if (!m) return;
    const rest = m[1].replace(/"\$\(_acp_np "[^"]*"\)"/g, "");
    for (const a of rest.matchAll(/"\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (PATHISH.test(a[1])) bad.push(`line ${i + 1}: ${l.trim()}`);
    }
  });
  assert.deepEqual(bad, [], "bare path handed to node -e (wrap it in \"$(_acp_np ...)\")");
  // The one site that reads the path from the environment instead.
  assert.match(SH, /HOME="\$\(_acp_np "\$HOME"\)" node -e 'const fs=require\("fs"\);const p=process\.env\.HOME/);
});
