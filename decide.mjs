// decide.mjs — LOCAL decision engine for Agentic Control Plane.
//
// Runs entirely on your machine. No account, no network, no phone-home: it
// classifies a tool call, applies a safety floor, and consults your local
// policy file (~/.acp/policy.json). This is the same *shape* of decision the
// hosted gateway makes — the hosted product adds the tuned risk classifier,
// cross-instance limits, team policy sync, cost X-ray, and the console.
//
// This module is intentionally pure and self-contained (no imports, no I/O) so
// it is trivial to review, run offline, and later publish as the open decision
// primitive. The dispatcher (govern.mjs) supplies the policy object and writes
// the audit line; this file only decides.
//
// It is mirrored verbatim into install.sh (~/.acp/decide.mjs at install time);
// test/mirror.test.mjs fails CI if the two ever diverge.

/** Split a command into argv-ish tokens, honoring quotes and stopping at the
 *  first shell control operator (| ; &). Env-assignments and wrappers are kept
 *  as tokens; callers strip them. */
function shellTokens(cmd) {
  const out = [];
  let buf = "";
  let quote = null;
  for (const ch of String(cmd)) {
    if (quote) { if (ch === quote) quote = null; else buf += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === " " || ch === "\t" || ch === "\n") { if (buf) { out.push(buf); buf = ""; } continue; }
    if (ch === "|" || ch === ";" || ch === "&") { if (buf) { out.push(buf); buf = ""; } break; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

// Wrappers that prefix another command. `valueFlags` are the flags whose value
// is a SEPARATE token (`sudo -u root`, `nice -n 10`); `operands` is how many
// positional operands the wrapper itself consumes before the real command
// (`timeout [flags] DURATION cmd…`). Skipping flags but not these operands is
// exactly the hole of #19: `timeout 5 rm -rf ~` classified as Bash.5.
const WRAPPERS = new Map([
  ["sudo", { valueFlags: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"]), operands: 0 }],
  ["doas", { valueFlags: new Set(["-u", "-C"]), operands: 0 }],
  ["env", { valueFlags: new Set(["-u", "-C", "-P", "-S"]), operands: 0 }],
  ["nice", { valueFlags: new Set(["-n", "--adjustment"]), operands: 0 }],
  ["nohup", { valueFlags: new Set(), operands: 0 }],
  ["setsid", { valueFlags: new Set(), operands: 0 }],
  ["stdbuf", { valueFlags: new Set(["-i", "-o", "-e"]), operands: 0 }],
  ["timeout", { valueFlags: new Set(["-s", "--signal", "-k", "--kill-after"]), operands: 1 }],
  ["time", { valueFlags: new Set(), operands: 0 }],
  ["xargs", { valueFlags: new Set(["-I", "-n", "-P", "-L", "-d", "-a", "-E", "-s"]), operands: 0 }],
  ["command", { valueFlags: new Set(), operands: 0 }],
  ["builtin", { valueFlags: new Set(), operands: 0 }],
]);

// Shell keywords are never the governed binary: `if rm -rf /; then …` and
// `{ rm -rf /; }` must classify as rm, not stall on the keyword.
const SHELL_KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "{", "}", "(", ")", "!"]);

/** Split a command line into its piped/chained segments (on unquoted | & ; ( )
 *  and newlines), so every command in a compound line is inspected, not just
 *  the first (e.g. `echo hi && rm -rf ~`, `( rm -rf ~ )`, `$(rm -rf ~)`). */
function splitSegments(cmd) {
  const segs = [];
  let buf = "";
  let quote = null;
  for (const ch of String(cmd)) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "|" || ch === "&" || ch === ";" || ch === "\n" || ch === "(" || ch === ")") { if (buf.trim()) segs.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) segs.push(buf.trim());
  return segs;
}

/** Strip leading env-assignments, shell keywords, and benign wrappers —
 *  including each wrapper's own option-arguments and positional operands
 *  (`sudo -u root …`, `timeout 5 …`, `nice -n 10 …`) — and return
 *  { bin, args } where bin is the canonical binary (basename, no path). */
function parseCommand(cmd) {
  const toks = shellTokens(cmd);
  let i = 0;
  let hops = 0;
  while (i < toks.length && hops++ < 32) {
    const t = toks[i];
    if (t.includes("=") && !t.startsWith("-")) { i++; continue; }        // FOO=bar
    if (SHELL_KEYWORDS.has(t)) { i++; continue; }                        // if / { / do …
    const w = WRAPPERS.get(t);
    if (w) {
      i++;
      while (i < toks.length && toks[i].startsWith("-")) {
        const flag = toks[i];
        i++;
        if (w.valueFlags.has(flag)) i++;                                 // sudo -u USER
      }
      for (let n = 0; n < w.operands && i < toks.length; n++) i++;       // timeout DURATION
      continue;
    }
    return { bin: t.split("/").pop(), args: toks.slice(i + 1) };
  }
  return { bin: "", args: [] };
}

/** Canonical binary of a shell command (basename), skipping env + wrappers. */
function canonicalBinary(cmd) {
  return parseCommand(cmd).bin;
}

/** First http(s) host in a command (for curl/wget), else undefined. */
function firstHost(cmd) {
  const m = String(cmd).match(/https?:\/\/([^/\s"']+)/i);
  if (!m) return undefined;
  return m[1].replace(/^www\./, "").toLowerCase();
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// Shell subcommands worth policy granularity: `git push` should be governable
// without also governing `git status`. Keep this small and obvious.
const SUBCOMMAND_BINS = new Set(["git", "gh", "docker", "kubectl", "npm", "pnpm", "yarn", "pip", "pip3", "gcloud", "aws", "systemctl"]);

// Global flags whose VALUE is a separate token, so the value is never
// mistaken for the subcommand: `git -C /repo push` is a push (was the
// malformed key "Bash.git.." — #19), `kubectl -n prod delete` is a delete.
const FLAGS_WITH_VALUE = new Set(["-C", "-c", "-H", "-n", "-R", "--git-dir", "--work-tree", "--namespace", "--context", "--cluster", "--kubeconfig", "--prefix", "--profile", "--project", "--config", "--repo"]);

/** First non-flag argument (the subcommand), lowercased, or undefined —
 *  skipping over flags AND their separate-token values. */
function firstSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      if (FLAGS_WITH_VALUE.has(a)) i++;                                  // git -C /repo
      continue;
    }
    return a.toLowerCase();
  }
  return undefined;
}

// ── Compound-command classification ───────────────────────────────────
// A compound command classifies by its MOST PRIVILEGED segment, and decide()
// policy-checks EVERY segment (strictest verdict wins) — classifying by the
// first segment let `true && gcloud …` run under Bash.true (#18). Rank
// mirrors the gateway's fix for this class (gsc#516 / gsc#750): benign
// navigational bins lose to unknown bins, which lose to privileged bins.

/** Benign / navigational binaries — never the interesting part of a
 *  compound command. */
const BENIGN_BINS = new Set([
  "cd", "echo", "printf", "true", "false", "pwd", "ls", "cat", "head", "tail",
  "less", "more", "grep", "rg", "wc", "sort", "uniq", "cut", "tr", "date",
  "sleep", "which", "type", "test", "[", "[[", "dirname", "basename",
  "readlink", "ps", "diff", "jq", "yq", "tee", "read", "exit", "return",
  "wait", "export", "set", "unset", "shift", "local", "declare",
]);

/** Binary classes that outrank an unknown binary when picking a compound
 *  command's classification: deploy/infra, source control, deletion, network
 *  egress, db clients, interpreters. */
const PRIVILEGED_BINS = new Set([
  "gcloud", "aws", "azure", "firebase", "terraform", "docker", "kubectl",
  "git", "gh", "npm", "pnpm", "yarn", "pip", "pip3", "rm", "mv", "chmod",
  "chown", "curl", "wget", "ssh", "scp", "rsync", "kill", "sed", "find",
  "psql", "mysql", "mariadb", "sqlite3", "systemctl", "launchctl",
  "powershell", "pwsh", "python", "python3", "node", "ruby", "perl", "cargo",
  "go", "make", "stripe", "vercel", "flyctl", "fly", "heroku", "tar", "open",
  "sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "eval",
]);

/** Privilege rank for most-privileged-segment selection: benign 0,
 *  unknown 1, privileged 2. Ties resolve to the EARLIEST unit. */
function privilegeRank(bin) {
  if (BENIGN_BINS.has(bin)) return 0;
  if (PRIVILEGED_BINS.has(bin)) return 2;
  return 1;
}

/** Every governed unit of a Bash command: one per segment, plus the payload
 *  of any `bash -c "…"` / `eval …` hand-off (recursed, capped), so neither a
 *  benign prefix nor an interpreter hop hides a unit from policy. */
function commandUnits(cmd, depth = 0) {
  const units = [];
  if (depth > 3) return units;
  for (const seg of splitSegments(cmd)) {
    const { bin, args } = parseCommand(seg);
    if (!bin) continue;
    units.push({ bin, args, seg });
    const inner = innerShellCommand(bin, args);
    if (inner) units.push(...commandUnits(inner, depth + 1));
  }
  return units;
}

/** Dotted policy key for one command unit. */
function unitKey(u) {
  if (u.bin === "curl" || u.bin === "wget") {
    const host = firstHost(u.seg);
    return host ? `Bash.curl.${host}` : "Bash.curl";
  }
  if (SUBCOMMAND_BINS.has(u.bin)) {
    const sub = firstSubcommand(u.args);
    return sub ? `Bash.${u.bin}.${sub}` : `Bash.${u.bin}`;
  }
  return `Bash.${u.bin}`;
}

/** The units of a Bash-shaped tool call, or null for other tools. */
function bashUnits(toolName, toolInput) {
  const name = String(toolName || "");
  if (name !== "Bash" && name !== "run_terminal_cmd" && name !== "shell") return null;
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});
  return commandUnits(String(input.command || input.cmd || ""));
}

/**
 * Classify a tool call into a dotted policy key, e.g. "Bash.rm",
 * "Bash.git.push", "Bash.curl.api.github.com", "Write", "WebFetch.example.com".
 * A non-empty command with no classifiable unit is the explicit
 * "Bash.unknown" (never a malformed or wrong-segment key): still governable
 * by a Bash.unknown rule, still falls back to "Bash" in the policy walk, and
 * honestly labeled as unparsed in the audit line rather than silently benign.
 */
export function classifyTool(toolName, toolInput) {
  const name = String(toolName || "");
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});

  if (name === "Bash" || name === "run_terminal_cmd" || name === "shell") {
    const cmd = String(input.command || input.cmd || "");
    const units = commandUnits(cmd);
    if (!units.length) return cmd.trim() ? "Bash.unknown" : "Bash";
    let best = units[0];
    for (const u of units) if (privilegeRank(u.bin) > privilegeRank(best.bin)) best = u;
    return unitKey(best);
  }
  if (name === "Write" || name === "Edit" || name === "MultiEdit" || name === "create_file" || name === "edit_file") {
    return "Write";
  }
  if (name === "Read" || name === "read_file" || name === "Glob" || name === "Grep" || name === "LS") {
    return "Read";
  }
  if (name === "WebFetch" || name === "WebSearch" || name === "web_search") {
    const host = firstHost(input.url || "");
    return host ? `WebFetch.${host}` : "WebFetch";
  }
  return name;
}

// ── Safety floor ──────────────────────────────────────────────────────
// Obvious, catastrophic, hard-to-undo actions denied regardless of policy.
// Deliberately conservative and OBVIOUS (not secret heuristics — the tuned
// detector lives in the hosted product). The bar: "no legitimate agent task
// ever needs this." Token-based where flag order/spelling varies, so the
// common phrasings can't slip past (rm -rf ~/ , rm -r -f / , git push -f , …).

/** Does this arg list carry short flag `letter` (e.g. -rf, -f) or `--long`? */
function hasShortOrLongFlag(args, letter, longName) {
  for (const a of args) {
    if (a === `--${longName}`) return true;
    if (/^-[a-z]+$/i.test(a) && a.slice(1).toLowerCase().includes(letter)) return true;
  }
  return false;
}

const RM_DANGER_TARGETS = new Set(["/", "/.", "~", "~/", "$HOME", "$HOME/", "${HOME}", ".", "./", "*", "/*", "./*", "~/*"]);

/** rm with BOTH recursive and force, aimed at a root/home/cwd/glob target. */
function rmForceFloor(bin, args) {
  if (bin !== "rm") return null;
  const recursive = hasShortOrLongFlag(args, "r", "recursive");
  const force = hasShortOrLongFlag(args, "f", "force");
  if (!recursive || !force) return null;
  const targets = args.filter((a) => !a.startsWith("-"));
  for (const t of targets) {
    const norm = t.replace(/\/+$/, ""); // trailing slash → same target (~/ ≡ ~)
    if (RM_DANGER_TARGETS.has(t) || RM_DANGER_TARGETS.has(norm) || norm === "") {
      return "recursive force-delete of a root/home path";
    }
  }
  return null;
}

/** git push that force-updates main/master (any flag order, -f or --force, or
 *  a +refspec). */
function gitForcePushFloor(bin, args) {
  if (bin !== "git") return null;
  if (firstSubcommand(args) !== "push") return null;
  const targetsMain = args.some((a) => /(^|[:+/])(main|master)$/.test(a));
  if (!targetsMain) return null;
  const forceFlag = hasShortOrLongFlag(args, "f", "force") || args.includes("--force-with-lease");
  const plusRefspec = args.some((a) => /^\+/.test(a) && /(main|master)/.test(a));
  if (forceFlag || plusRefspec) return "force-push to main/master";
  return null;
}

// Shells whose `-c <string>` argument is itself a command line: recurse the
// floor into it so `bash -c "rm -rf ~"` can't launder past token inspection.
const SHELL_BINS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);

/** If this command hands a string to another interpreter (`bash -c '…'`,
 *  `eval …`), return that inner command line; else undefined. */
function innerShellCommand(bin, args) {
  if (SHELL_BINS.has(bin)) {
    for (let i = 0; i < args.length; i++) {
      if (/^-[a-z]*c[a-z]*$/i.test(args[i])) return args[i + 1];
    }
    return undefined;
  }
  if (bin === "eval") return args.join(" ");
  return undefined;
}

/** Token floors, per segment, recursing one level into shell -c / eval. */
function tokenFloorScan(cmd, depth = 0) {
  if (depth > 3) return null;
  for (const seg of splitSegments(cmd)) {
    const { bin, args } = parseCommand(seg);
    const hit = rmForceFloor(bin, args) || gitForcePushFloor(bin, args);
    if (hit) return hit;
    const inner = innerShellCommand(bin, args);
    if (inner) {
      const h = tokenFloorScan(inner, depth + 1);
      if (h) return h;
    }
  }
  return null;
}

const REGEX_RULES = [
  [/\bmkfs\.[a-z0-9]+\b|\bmkfs\s/i, "filesystem format (mkfs)"],
  [/\bdd\b[^|;&]*\bof=\/dev\/(sd|nvme|disk|hd)/i, "raw disk overwrite (dd of=/dev/…)"],
  [/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb"],
  [/\bchmod\s+-R\s+0*777\s+\/(\s|$)/i, "recursive chmod 777 on /"],
  [/>\s*\/dev\/(sd|nvme|disk|hd)[a-z0-9]*/i, "redirect over a raw disk device"],
];

/**
 * The safety floor: obvious, catastrophic commands denied regardless of policy.
 * Returns a deny reason, or null.
 */
export function hardlineFloor(toolName, toolInput) {
  const name = String(toolName || "");
  if (name !== "Bash" && name !== "run_terminal_cmd" && name !== "shell") return null;
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});
  const cmd = String(input.command || input.cmd || "");

  // Token floors run per-segment so a catastrophe hidden after `&&`/`;`/`|`
  // (e.g. `echo ok && rm -rf ~`) is still caught, and recurse into
  // `bash -c "…"` / `eval …` so hand-off to another shell can't launder it.
  const tokenFloor = tokenFloorScan(cmd);
  if (tokenFloor) return tokenFloor;

  const c = cmd.replace(/\s+/g, " ").trim();
  for (const [re, why] of REGEX_RULES) if (re.test(c)) return why;
  return null;
}

// ── Context guard ─────────────────────────────────────────────────────
// Whole-file reads are the cheapest thing an agent does and the most
// expensive thing it puts in a frontier model's context. The guard sizes a
// read BEFORE it happens: Read (offset/limit-aware) and the shell dumpers
// (cat/head/tail/less/more/bat). Piped or redirected dumps pass — those are
// targeted. readIntent() is pure parsing; the dispatcher counts the lines
// (I/O) and hands them back as `context.files`.

const DUMP_BINS = new Set(["cat", "head", "tail", "less", "more", "bat", "batcat"]);

/** Split on unquoted | & ; newline, keeping the operator that FOLLOWS each
 *  segment so a pipe after a dump can be told from a chain before it. */
function splitSegmentsWithOps(cmd) {
  const out = [];
  let buf = "";
  let quote = null;
  for (const ch of String(cmd)) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "|" || ch === "&" || ch === ";" || ch === "\n") {
      if (buf.trim()) out.push({ seg: buf.trim(), op: ch });
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push({ seg: buf.trim(), op: "" });
  return out;
}

function unquote(t) { return String(t).replace(/^(['"])(.*)\1$/, "$2"); }
function toCount(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; }

/** head/tail line limits: -N, -nN, -n N, --lines=N, --lines N. Byte ranges
 *  (-c) and follow (-f) are targeted by construction. */
function dumpArgs(bin, args) {
  let limit = null;
  let targeted = false;
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { for (const rest of args.slice(i + 1)) paths.push(unquote(rest)); break; }
    if (!a.startsWith("-") || a === "-") { paths.push(unquote(a)); continue; }
    if (bin === "head" || bin === "tail") {
      let m;
      if ((m = a.match(/^-(\d+)$/))) { limit = toCount(m[1]); continue; }
      if ((m = a.match(/^-n\+?(\d+)$/))) { limit = toCount(m[1]); continue; }
      if ((m = a.match(/^--lines=\+?(\d+)$/))) { limit = toCount(m[1]); continue; }
      if (a === "-n" || a === "--lines") { limit = toCount(String(args[i + 1] || "").replace(/^\+/, "")); i++; continue; }
      if (a === "-c" || a === "--bytes") { targeted = true; i++; continue; }
      if (/^-c\d+$/.test(a) || /^--bytes=/.test(a)) { targeted = true; continue; }
      if (a === "-f" || a === "-F" || a === "--follow") { targeted = true; continue; }
    }
    if (bin === "bat" || bin === "batcat") {
      let m;
      if ((m = a.match(/^(?:-r|--line-range)=?(\d+):(\d+)$/))) { limit = Math.max(0, toCount(m[2]) - toCount(m[1]) + 1); continue; }
      if (a === "-r" || a === "--line-range") { const r = String(args[i + 1] || "").match(/^(\d+):(\d+)$/); if (r) limit = Math.max(0, toCount(r[2]) - toCount(r[1]) + 1); i++; continue; }
    }
  }
  // head/tail with no explicit count print 10 lines.
  if ((bin === "head" || bin === "tail") && limit === null && !targeted) limit = 10;
  return { limit, targeted, paths };
}

/**
 * What would this call pull into context? Returns null when the call is not
 * a whole-file read, else { via, paths, offset, limit, targeted }:
 *   via      "Read" | "Bash.cat" | "Bash.head" | …
 *   paths    files the dispatcher should size
 *   offset   1-based start line (Read) — lines before it are not read
 *   limit    max lines read, or null for "to the end"
 *   targeted true when the shape is already narrow (byte-ranged, followed);
 *            the guard never blocks these
 */
export function readIntent(toolName, toolInput) {
  const name = String(toolName || "");
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});

  if (name === "Read" || name === "read_file") {
    const path = input.file_path || input.path || input.target_file || "";
    if (!path) return null;
    const offset = toCount(input.offset);
    const limit = toCount(input.limit);
    return { via: "Read", paths: [String(path)], offset: offset && offset > 0 ? offset : null, limit: limit && limit > 0 ? limit : null, targeted: false };
  }

  if (name === "Bash" || name === "run_terminal_cmd" || name === "shell") {
    const raw = input.command || input.cmd || "";
    const cmd = Array.isArray(raw) ? raw.map(String).join(" ") : String(raw);
    if (!cmd.trim()) return null;
    for (const { seg, op } of splitSegmentsWithOps(cmd)) {
      const { bin, args } = parseCommand(seg);
      if (!DUMP_BINS.has(bin)) continue;
      if (op === "|") continue;                       // dump feeds a filter — targeted
      if (/(^|[^\\])>/.test(seg)) continue;            // redirected to a file — never enters context
      const { limit, targeted, paths } = dumpArgs(bin, args);
      const files = paths.filter((p) => p && p !== "-");
      if (!files.length) continue;                    // reads stdin
      return { via: `Bash.${bin}`, paths: files, offset: null, limit, targeted };
    }
    return null;
  }
  return null;
}

const GUARD_MODES = new Set(["off", "shadow", "enforce"]);

/**
 * Size a read against the guard. `files` maps path → { lines, bytes } as the
 * dispatcher measured them (unmeasured paths are skipped — the tool surfaces
 * its own not-found error). Returns null when nothing applies, else
 * { mode, action, lines, effectiveLines, estTokens, maxLines, paths, via, guidance }.
 */
export function contextGuard(intent, files, guard) {
  if (!intent || !guard || typeof guard !== "object") return null;
  const mode = GUARD_MODES.has(guard.mode) ? guard.mode : "off";
  if (mode === "off") return null;
  const maxLines = toCount(guard.maxLines);
  if (!maxLines) return null;
  if (intent.targeted) return null;
  const known = intent.paths.map((p) => [p, files && files[p]]).filter(([, f]) => f && Number.isFinite(f.lines));
  if (!known.length) return null;
  let lines = 0, effectiveLines = 0, bytes = 0;
  for (const [, f] of known) {
    lines += f.lines;
    let eff = f.lines;
    if (intent.offset) eff = Math.max(0, eff - (intent.offset - 1));
    if (intent.limit !== null && intent.limit !== undefined) eff = Math.min(eff, intent.limit);
    effectiveLines += eff;
    bytes += Number.isFinite(f.bytes) ? f.bytes : 0;
  }
  if (effectiveLines <= maxLines) return null;
  const avgBytesPerLine = lines > 0 && bytes > 0 ? bytes / lines : 40;
  const estTokens = Math.round((effectiveLines * avgBytesPerLine) / 4);
  const action = guard.action === "ask" ? "ask" : "deny";
  return { mode, action, lines, effectiveLines, estTokens, maxLines, paths: known.map(([p]) => p), via: intent.via,
           guidance: typeof guard.guidance === "string" && guard.guidance.trim() ? guard.guidance.trim() : "" };
}

/** Default steer, per harness. A block always names the sanctioned path. */
export function contextGuardSteer(harness) {
  if (harness === "codex") {
    return "Read just the section you need (sed -n 'START,ENDp' FILE, or grep -n PATTERN FILE), or send the whole-file read to a subagent so it stays out of this context.";
  }
  return "Read just the section you need (offset/limit, or grep for the symbol), or hand the whole-file read to a subagent so it stays out of this context.";
}

/**
 * Walk a dotted key from most-specific to least, e.g.
 * "Bash.curl.api.github.com" → [..., "Bash.curl", "Bash"].
 */
export function candidates(key) {
  const parts = String(key).split(".");
  const out = [];
  for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).join("."));
  return out;
}

const VALID = new Set(["allow", "ask", "deny"]);
const SEVERITY = { allow: 0, ask: 1, deny: 2 };

/**
 * Decide a tool call locally.
 * @param policy { default: "allow"|"ask"|"deny", rules: { [key]: "allow"|"ask"|"deny" },
 *                 contextGuard?: { maxLines, mode: "off"|"shadow"|"enforce", action?: "deny"|"ask", guidance? } }
 * @param context { files?: { [path]: { lines, bytes } }, harness?: string } — measured by the dispatcher
 * @returns { decision, reason, source, classified, contextGuard? }
 */
export function decide(toolName, toolInput, policy, context) {
  const floor = hardlineFloor(toolName, toolInput);
  if (floor) return { decision: "deny", reason: floor, source: "hardline", classified: classifyTool(toolName, toolInput) };

  const key = classifyTool(toolName, toolInput);
  const rules = (policy && policy.rules) || {};

  // Context guard: a sized read over the line ceiling. Enforce → deny/ask
  // with the steer; shadow → decide as usual, but carry what would have
  // happened (and the tokens it would have kept out of context) so the
  // audit line records it.
  const guard = contextGuard(readIntent(toolName, toolInput), context && context.files, policy && policy.contextGuard);
  if (guard && guard.mode === "enforce") {
    const steer = guard.guidance || contextGuardSteer(context && context.harness);
    return { decision: guard.action, source: "context-guard", classified: key, contextGuard: guard,
             reason: `whole-file read of ${guard.effectiveLines} lines (ceiling ${guard.maxLines}; ~${guard.estTokens} tokens into context). ${steer}` };
  }
  const shadow = guard && guard.mode === "shadow" ? guard : undefined;

  // EVERY unit of a compound command is policy-checked, and the strictest
  // matched rule wins (deny > ask > allow) — so `true && gcloud …` cannot
  // slip a gcloud rule behind a benign first segment (#18).
  const units = bashUnits(toolName, toolInput);
  const keys = units && units.length ? [...new Set(units.map(unitKey))] : [key];
  let hit = null;
  for (const k of keys) {
    for (const cand of candidates(k)) {
      const r = rules[cand];
      if (VALID.has(r)) {
        if (!hit || SEVERITY[r] > SEVERITY[hit.r]) hit = { r, cand };
        break;
      }
    }
  }
  if (hit) return { decision: hit.r, reason: `local policy: ${hit.cand} → ${hit.r}`, source: "policy", classified: key, contextGuard: shadow };

  const def = VALID.has(policy && policy.default) ? policy.default : "allow";
  return { decision: def, reason: `local policy: default → ${def}`, source: "default", classified: key, contextGuard: shadow };
}
