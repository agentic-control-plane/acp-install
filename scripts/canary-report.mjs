#!/usr/bin/env node
// Harness canary reporter: one deduped GitHub issue per harness in
// davidcrowe/gatewaystack-connect.
//
//   canary-report.mjs --harness <id> --status <success|failure> --version <v>
//                     --run-url <url> [--failed-step <name>] [--log <file>]
//                     [--drift-issue <n> [--drift-version <v>] [--drift-kind release|docs] [--drift-close on|off]]
//                     [--dry-run]
//
// Dedup: the open issue labelled `canary` + `harness:<id>` (and, as a
// belt-and-braces check, carrying the `<!-- harness-canary:<id> -->`
// marker in its body). Failure with no open issue -> create one. Failure
// with an open issue -> comment the run URL and version. Success with an
// open issue -> comment and close. Success with none -> nothing to do.
//
// Drift pairing: when the run was dispatched by the drift scout
// (repository_dispatch harness-release with client_payload.drift_issue),
// the verdict is also posted as a comment on that drift issue:
//   "Canary <leg> on <version>: ✅ passed: safe to close", or
//   "Canary <leg> on <version>: ❌ failed at <step>: see <canary issue / run>".
// On a pass the drift issue is closed too when --drift-close is on. Default:
// on for release-type drift (`--drift-kind release`, the only kind the scout
// dispatches today), off for docs-page drift (`--drift-kind docs`), since a
// green canary says nothing about a changed docs page.
//
// Auth: CANARY_ISSUES_TOKEN (a fine-grained PAT with Issues: read/write on
// the target repo). --dry-run prints the requests instead of sending them.

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
const harness = opt("harness");
const status = opt("status");
const version = opt("version", "unknown");
const runUrl = opt("run-url", "");
const failedStep = opt("failed-step", "none");
const logFile = opt("log", "");
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

const marker = `<!-- harness-canary:${harness} -->`;
const labels = ["canary", `harness:${harness}`];
const stamp = new Date().toISOString();

async function gh(method, path, body) {
  if (dryRun) {
    console.log(`[dry-run] ${method} ${path}${body ? "\n" + JSON.stringify(body, null, 2) : ""}`);
    return method === "GET" ? [] : { html_url: "(dry-run)" };
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
        body: `${head}: ✅ passed: safe to close${driftClose ? " — closing." : "."}${tail}`,
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
      body: `${head}: ❌ failed at \`${failedStep}\`: see ${see}${tail}`,
    });
    console.log(`drift #${driftIssue}: failed at ${failedStep}, commented`);
  } catch (e) {
    console.error(`drift #${driftIssue}: could not post the verdict: ${e.message ?? e}`);
  }
}

async function main() {
  const canaryIssueUrl = await reportCanaryIssue();
  await reportToDriftIssue(canaryIssueUrl);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
