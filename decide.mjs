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
// It is mirrored verbatim into install.sh (~/.acp/decide.mjs at install time).

/** Strip leading env-assignments / sudo / benign wrappers, return argv-ish tokens. */
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

const WRAPPERS = new Set(["sudo", "env", "nice", "nohup", "stdbuf", "timeout", "time", "xargs", "command"]);

/** Canonical binary of a shell command, skipping env-vars and benign wrappers. */
function canonicalBinary(cmd) {
  const toks = shellTokens(cmd);
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (t.includes("=") && !t.startsWith("-")) { i++; continue; } // FOO=bar
    if (WRAPPERS.has(t)) { i++; while (i < toks.length && toks[i].startsWith("-")) i++; continue; }
    return t.split("/").pop();
  }
  return "";
}

/** First http(s) host in a command (for curl/wget), else undefined. */
function firstHost(cmd) {
  const m = String(cmd).match(/https?:\/\/([^/\s"']+)/i);
  if (!m) return undefined;
  return m[1].replace(/^www\./, "").toLowerCase();
}

/**
 * Classify a tool call into a dotted policy key, e.g. "Bash.rm",
 * "Bash.curl.api.github.com", "Write", "WebFetch.example.com".
 */
export function classifyTool(toolName, toolInput) {
  const name = String(toolName || "");
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});

  if (name === "Bash" || name === "run_terminal_cmd" || name === "shell") {
    const cmd = input.command || input.cmd || "";
    const bin = canonicalBinary(cmd);
    if (!bin) return "Bash";
    if (bin === "curl" || bin === "wget") {
      const host = firstHost(cmd);
      return host ? `Bash.curl.${host}` : "Bash.curl";
    }
    return `Bash.${bin}`;
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

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/**
 * The safety floor: obvious, catastrophic, hard-to-undo commands that should be
 * denied regardless of policy. Deliberately conservative and OBVIOUS (these are
 * not secret heuristics — the tuned detector lives in the hosted product).
 * Returns a deny reason, or null.
 */
export function hardlineFloor(toolName, toolInput) {
  const name = String(toolName || "");
  if (name !== "Bash" && name !== "run_terminal_cmd" && name !== "shell") return null;
  const input = typeof toolInput === "string" ? safeParse(toolInput) : (toolInput || {});
  const cmd = String(input.command || input.cmd || "");
  const c = cmd.replace(/\s+/g, " ").trim();

  const RULES = [
    [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-rf|-fr)\b[^|;&]*\s(\/|~|\$HOME|\/\*|\.)(\s|$)/i, "recursive force-delete of a root/home path"],
    [/\bmkfs\.[a-z0-9]+\b|\bmkfs\s/i, "filesystem format (mkfs)"],
    [/\bdd\b[^|;&]*\bof=\/dev\/(sd|nvme|disk|hd)/i, "raw disk overwrite (dd of=/dev/…)"],
    [/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb"],
    [/\bchmod\s+-R\s+0*777\s+\/(\s|$)/i, "recursive chmod 777 on /"],
    [/>\s*\/dev\/(sd|nvme|disk|hd)[a-z0-9]*/i, "redirect over a raw disk device"],
    [/\bgit\s+push\b[^|;&]*--force[^|;&]*\b(origin\s+)?(main|master)\b/i, "force-push to main/master"],
  ];
  for (const [re, why] of RULES) if (re.test(c)) return why;
  return null;
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

/**
 * Decide a tool call locally.
 * @param policy { default: "allow"|"ask"|"deny", rules: { [key]: "allow"|"ask"|"deny" } }
 * @returns { decision, reason, source, classified }
 */
export function decide(toolName, toolInput, policy) {
  const floor = hardlineFloor(toolName, toolInput);
  if (floor) return { decision: "deny", reason: floor, source: "hardline", classified: classifyTool(toolName, toolInput) };

  const key = classifyTool(toolName, toolInput);
  const rules = (policy && policy.rules) || {};
  for (const cand of candidates(key)) {
    const r = rules[cand];
    if (VALID.has(r)) {
      return { decision: r, reason: `local policy: ${cand} → ${r}`, source: "policy", classified: key };
    }
  }
  const def = VALID.has(policy && policy.default) ? policy.default : "allow";
  return { decision: def, reason: `local policy: default → ${def}`, source: "default", classified: key };
}
