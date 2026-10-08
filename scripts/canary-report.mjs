#!/usr/bin/env node
// Harness canary reporter: one deduped GitHub issue per harness in
// davidcrowe/gatewaystack-connect, plus the sweep that resolves the drift
// scout's release issues for the version this run tested.
//
//   canary-report.mjs --harness <id> --status <success|failure> --version <v>
//                     --run-url <url> [--failed-step <name>] [--log <file>]
//                     [--tested <entryId=version,...>]
//                     [--drift-issue <n> [--drift-version <v>] [--drift-kind release|docs] [--drift-close on|off]]
//                     [--dry-run [--fixture <json>]]
//
// Dedup: the open issue labelled `canary` + `harness:<id>` (and, as a
// belt-and-braces check, carrying the `<!-- harness-canary:<id> -->`
// marker in its body). Failure with no open issue -> create one. Failure
// with an open issue -> comment the run URL and version. Success with an
// open issue -> comment and close. Success with none -> nothing to do.
//
// Drift sweep (no dispatch token needed): the drift scout (gatewaystack-
// connect, apps/tenant-gateway/src/drift) files ONE issue per upstream
// release, label `drift`, body marker
// `<!-- drift-scout:key=release:<entryId>@<version> -->`. After reporting
// the leg, this script lists the open `drift` issues, keeps those whose
// marker names a registry entry mapped to this leg (LEG_ENTRIES below
// mirrors `canaryLeg` in the scout's registry.ts) and whose normalised
// version equals the version this run tested, and posts the verdict:
//   pass: "Canary <leg> on <version>: ✅ passed — closing." + close (completed)
//   fail: "Canary <leg> on <version>: ❌ failed at <step>: <link>" once per
//         failure (not repeated when the reporter's last comment on that
//         issue already says failed for the same version).
// Docs-type drift issues (non-release markers) are never touched. The
// scheduled run (every 6 h, latest versions) is what resolves a release
// issue, within ~6 h of the scout filing it.
//
// Drift pairing (kept): when the run was dispatched by the scout with
// client_payload.drift_issue, the verdict is posted on that issue too, and
// the sweep skips it so it is not commented twice.
//
// --tested: for SDK legs `--version` is the ACP package's version, not the
// upstream's; the workflow passes the upstream versions it actually
// installed as `entryId=version` pairs (e.g. `langchain-core=1.6.4`). An
// SDK entry without a pair is skipped by the sweep. Harness legs use
// --version (the harness's own `--version` output, normalised).
//
// Auth: CANARY_ISSUES_TOKEN (a fine-grained PAT with Issues: read/write on
// the target repo). --dry-run prints the requests instead of sending them;
// --fixture <json> ({drift: [...issues], canary: [...issues], comments:
// [...]}) is what dry-run GETs return, so the sweep can be previewed.

import fs from "node:fs";

const REPO = process.env.CANARY_ISSUES_REPO || "davidcrowe/gatewaystack-connect";
const API = "https://api.github.com";
const MAX_LOG_CHARS = 6000;

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const dryRun = args.includes("--dry-run");
const fixtureFile = opt("fixture", "");
const harness = opt("harness");
const status = opt("status");
const version = opt("version", "unknown");
const runUrl = opt("run-url", "");
const failedStep = opt("failed-step", "none");
const logFile = opt("log", "");
const tested = opt("tested", "");
const driftIssue = Number(opt("drift-issue", "")) || 0;
const driftVersion = opt("drift-version", "") || version;
const driftKind = opt("drift-kind", "release") === "docs" ? "docs" : "release";
const driftCloseOpt = opt("drift-close", "");
const driftClose = driftCloseOpt ? /^(on|true|1|yes)$/i.test(driftCloseOpt) : driftKind === "release";

// Leg ids: every harness leg and every sdk-* leg the workflow defines (the
// list lives in canary-assert.mjs; here any well-formed id is accepted so a
// new leg cannot silently lose its reporter).
const LIVE_LEGS = new Set(["claude-code", "opencode", "qwen-code", "pi", "prime-agent"]);
if (!/^[a-z][a-z0-9-]*$/.test(harness ?? "") || !["success", "failure"].includes(status)) {
  console.error("usage: canary-report.mjs --harness <leg id> --status <success|failure> ...");
  process.exit(2);
}
const isSdk = harness.startsWith("sdk-");
const token = process.env.CANARY_ISSUES_TOKEN;
if (!token && !dryRun) {
  console.error("CANARY_ISSUES_TOKEN is not set (pass --dry-run to preview)");
  process.exit(2);
}

// Canary leg -> drift-registry entry ids. Mirror of `canaryLeg` in
// gatewaystack-connect apps/tenant-gateway/src/drift/registry.ts; keep in
// step when an entry gains or changes its leg.
const LEG_ENTRIES = {
  "claude-code": ["claude-code"],
  codex: ["codex"],
  opencode: ["opencode"],
  "qwen-code": ["qwen-code"],
  pi: ["pi"],
  "prime-agent": ["prime-agent"],
  grok: ["grok"],
  dsh: ["dsh"],
  hermes: ["hermes"],
  openclaw: ["openclaw"],
  muse: ["muse"],
  "sdk-crewai": ["crewai"],
  "sdk-langchain": ["langchain-core", "langgraph"],
  "sdk-governance-anthropic": ["anthropic-sdk-typescript"],
};
const DRIFT_LABEL = "drift";
const RELEASE_MARKER = /drift-scout:key=release:([^@\s]+)@([^\s<]*)/;
const VERDICT_MARKER = (v, result) => `<!-- harness-canary:verdict leg=${harness} version=${v} result=${result} -->`;

// Same rule as normalizeVersion in the scout's issue.ts: "v1.1.0",
// "rust-v0.150.0", "langchain-core==1.6.4", "2.0.14 (Claude Code)" ->
// "1.1.0", "0.150.0", "1.6.4", "2.0.14". Pre-release suffixes survive.
function normalizeVersion(s) {
  const t = (s ?? "").trim();
  const m = t.match(/\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.+-]*)?/);
  return m ? m[0] : t.replace(/^v(?=\d)/i, "");
}

const testedPairs = Object.fromEntries(
  tested.split(",").map((s) => s.trim()).filter((s) => s.includes("="))
    .map((s) => [s.slice(0, s.indexOf("=")).trim(), s.slice(s.indexOf("=") + 1).trim()])
    .filter(([, v]) => v),
);
// The normalised version this run tested for one registry entry, or null
// when it cannot be known (an SDK entry the workflow passed no pair for).
function testedVersionFor(entryId) {
  if (testedPairs[entryId]) return normalizeVersion(testedPairs[entryId]);
  if (isSdk) return null;
  return normalizeVersion(version);
}

const marker = `<!-- harness-canary:${harness} -->`;
const labels = ["canary", `harness:${harness}`];
const stamp = new Date().toISOString();

let fixture = null;
if (dryRun && fixtureFile) fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));

async function gh(method, path, body) {
  if (dryRun) {
    console.log(`[dry-run] ${method} ${path}${body ? "\n" + JSON.stringify(body, null, 2) : ""}`);
    if (method !== "GET") return { html_url: "(dry-run)" };
    if (!fixture) return [];
    if (path.includes("/comments")) return fixture.comments ?? [];
    if (path.includes(`labels=${DRIFT_LABEL}&`) || path.endsWith(`labels=${DRIFT_LABEL}`)) return fixture.drift ?? [];
    return fixture.canary ?? [];
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "acp-harness-canary",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// --log takes one file or a comma-separated list; each present file gets
// its own collapsed excerpt (the harness transcript plus the audit poll).
function logExcerpt() {
  if (!logFile) return "";
  let out = "";
  for (const file of logFile.split(",").map((s) => s.trim()).filter(Boolean)) {
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (text.length > MAX_LOG_CHARS) text = "...\n" + text.slice(-MAX_LOG_CHARS);
    out += `\n<details><summary>Log excerpt (${file})</summary>\n\n\`\`\`\n${text.replace(/`/g, "'")}\n\`\`\`\n</details>\n`;
  }
  return out;
}

async function findOpenIssue() {
  const q = new URLSearchParams({ state: "open", labels: labels.join(","), per_page: "20" });
  const list = await gh("GET", `/repos/${REPO}/issues?${q}`);
  const issues = (Array.isArray(list) ? list : []).filter((i) => !i.pull_request);
  return issues.find((i) => String(i.body ?? "").includes(marker)) ?? issues[0] ?? null;
}

const runLine = `Run: ${runUrl || "(no run url)"} · harness version: \`${version}\` · ${stamp}`;

// Files/updates/closes the canary issue; returns the canary issue URL the
// drift comment should point at (null when the run is green and no issue
// was open).
async function reportCanaryIssue() {
  const open = await findOpenIssue();
  if (status === "failure") {
    if (open) {
      await gh("POST", `/repos/${REPO}/issues/${open.number}/comments`, {
        body: `Still failing at step \`${failedStep}\`.\n\n${runLine}${logExcerpt()}`,
      });
      console.log(`updated #${open.number}`);
      return open.html_url;
    }
    const created = await gh("POST", `/repos/${REPO}/issues`, {
      title: `harness canary: ${harness} failing at ${failedStep}`,
      labels,
      body: [
        marker,
        `The harness canary (acp-install, \`.github/workflows/harness-canary.yml\`) failed for **${harness}**.`,
        "",
        `- Failing step: \`${failedStep}\``,
        `- Harness version: \`${version}\``,
        `- ${runLine}`,
        driftIssue ? `- Triggered by drift issue #${driftIssue} (upstream ${driftVersion})` : "",
        "",
        isSdk
          ? `The canary installs the published ${harness.slice(4)} package at latest, makes one governed tool-call check against the canary workspace (POST /govern/tool-use, tool \`shell\`, \`echo <marker>\`; the proxy SDK makes one acpFetch through ACP's egress instead) and, except for the proxy leg, asserts the audit row landed. Steps: install-package, run-check, audit-row. This issue is updated on every failing run and closed automatically on the next run where every step is green.`
          : LIVE_LEGS.has(harness)
            ? `The canary installs the current released harness, installs ACP via the live installer with a seeded key, asserts the install invariants, pushes one governed \`echo\` through the \`${harness}\` launcher (model traffic through ACP's proxy: Gemini on the platform key, or the canary's own subscription OAuth for claude-code) and asserts the audit row landed. A transcript containing a rejection (\`auto-rejecting\`, \`rejected permission\`, \`Denied at approval\`, ...) fails the governed-call step (gsc#1380); the audit rows in the window are printed with their \`decision\` so it can be classified. This issue is updated on every failing run and closed automatically on the next run where every step is green.`
            : "The canary installs the current released harness, installs ACP via the live installer with a seeded key and asserts the install invariants (plugin/hook/provider wired exactly once, launcher executable, directive once, no key literal in any config). This leg has no live governed call: the harness cannot run headless on a model that needs no vendor key (docs/harness-canary.md has the per-leg reason). This issue is updated on every failing run and closed automatically on the next run where every step is green.",
        logExcerpt(),
      ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"),
    });
    console.log(`created ${created.html_url}`);
    return created.html_url;
  }
  // success
  if (!open) { console.log("green, no open canary issue"); return null; }
  await gh("POST", `/repos/${REPO}/issues/${open.number}/comments`, { body: `Green again. ${runLine}` });
  await gh("PATCH", `/repos/${REPO}/issues/${open.number}`, { state: "closed", state_reason: "completed" });
  console.log(`closed #${open.number}`);
  return null;
}

// The verdict comment for one drift issue. `v` is the version as the drift
// issue states it (normalised); the hidden marker is what the sweep's
// dedupe reads back.
function verdictComment(v, canaryIssueUrl) {
  const head = `Canary \`${harness}\` on \`${v}\``;
  const tail = `\n\n${runLine}`;
  if (status === "success") {
    return { pass: true, body: `${VERDICT_MARKER(v, "passed")}\n${head}: ✅ passed — closing.${tail}` };
  }
  const see = canaryIssueUrl || runUrl || "(no link)";
  return { pass: false, body: `${VERDICT_MARKER(v, "failed")}\n${head}: ❌ failed at \`${failedStep}\`: ${see}${tail}` };
}

// Posts the verdict on the drift issue that dispatched this run. Best
// effort: a failure here is logged and does not fail the reporter, so the
// canary issue (the primary record) is never lost to a drift-side hiccup.
async function reportToDriftIssue(canaryIssueUrl) {
  if (!driftIssue) return;
  const head = `Canary \`${harness}\` on \`${driftVersion}\``;
  const tail = `\n\n${runLine}`;
  try {
    if (status === "success") {
      await gh("POST", `/repos/${REPO}/issues/${driftIssue}/comments`, {
        body: `${VERDICT_MARKER(normalizeVersion(driftVersion), "passed")}\n${head}: ✅ passed: safe to close${driftClose ? " — closing." : "."}${tail}`,
      });
      if (driftClose) {
        await gh("PATCH", `/repos/${REPO}/issues/${driftIssue}`, { state: "closed", state_reason: "completed" });
        console.log(`drift #${driftIssue}: passed, closed`);
      } else {
        console.log(`drift #${driftIssue}: passed, left open (${driftKind} drift)`);
      }
      return;
    }
    const see = canaryIssueUrl ?? runUrl ?? "(no link)";
    await gh("POST", `/repos/${REPO}/issues/${driftIssue}/comments`, {
      body: `${VERDICT_MARKER(normalizeVersion(driftVersion), "failed")}\n${head}: ❌ failed at \`${failedStep}\`: see ${see}${tail}`,
    });
    console.log(`drift #${driftIssue}: failed at ${failedStep}, commented`);
  } catch (e) {
    console.error(`drift #${driftIssue}: could not post the verdict: ${e.message ?? e}`);
  }
}

// True when the reporter's most recent verdict on this issue already says
// "failed" for the same version: a later red run on the same version adds
// nothing, so it is not repeated. A pass, or a verdict for another version,
// does not suppress.
async function alreadyFailedHere(issueNumber, v) {
  const q = new URLSearchParams({ per_page: "100" });
  const list = await gh("GET", `/repos/${REPO}/issues/${issueNumber}/comments?${q}`);
  const mine = (Array.isArray(list) ? list : []).filter((c) => String(c.body ?? "").includes(`harness-canary:verdict leg=${harness} `));
  const last = mine[mine.length - 1];
  return !!last && String(last.body).includes(VERDICT_MARKER(v, "failed"));
}

// Finds every open release-type drift issue for an entry mapped to this leg
// at the version this run tested and posts the verdict (close on pass).
// Best effort, same as reportToDriftIssue.
async function sweepDriftIssues(canaryIssueUrl) {
  const entries = LEG_ENTRIES[harness];
  if (!entries) { console.log(`drift sweep: no registry entry maps to leg ${harness}`); return; }
  const want = new Map();
  for (const id of entries) {
    const v = testedVersionFor(id);
    if (v) want.set(id, v);
  }
  if (want.size === 0) { console.log(`drift sweep: no tested upstream version known for ${entries.join(", ")} (pass --tested)`); return; }
  console.log(`drift sweep: ${[...want].map(([id, v]) => `${id}@${v}`).join(", ")}`);
  try {
    const q = new URLSearchParams({ state: "open", labels: DRIFT_LABEL, per_page: "100" });
    const list = await gh("GET", `/repos/${REPO}/issues?${q}`);
    const issues = (Array.isArray(list) ? list : []).filter((i) => !i.pull_request);
    let touched = 0;
    for (const issue of issues) {
      if (issue.number === driftIssue) continue; // already handled by the pairing path
      const m = String(issue.body ?? "").match(RELEASE_MARKER);
      if (!m) continue; // docs-type drift: a green canary says nothing about it
      const [, entryId, markerVersion] = m;
      const v = want.get(entryId);
      if (!v || normalizeVersion(markerVersion) !== v) continue;
      touched++;
      const { pass, body } = verdictComment(v, canaryIssueUrl);
      if (!pass && await alreadyFailedHere(issue.number, v)) {
        console.log(`drift #${issue.number} (${entryId}@${v}): already marked failed on ${v}, not repeating`);
        continue;
      }
      await gh("POST", `/repos/${REPO}/issues/${issue.number}/comments`, { body });
      if (pass) {
        await gh("PATCH", `/repos/${REPO}/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
        console.log(`drift #${issue.number} (${entryId}@${v}): passed, closed`);
      } else {
        console.log(`drift #${issue.number} (${entryId}@${v}): failed at ${failedStep}, commented`);
      }
    }
    if (touched === 0) console.log(`drift sweep: no open release drift issue matches (${issues.length} open drift issues scanned)`);
  } catch (e) {
    console.error(`drift sweep: ${e.message ?? e}`);
  }
}

async function main() {
  const canaryIssueUrl = await reportCanaryIssue();
  await reportToDriftIssue(canaryIssueUrl);
  await sweepDriftIssues(canaryIssueUrl);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
