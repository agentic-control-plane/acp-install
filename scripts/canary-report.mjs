#!/usr/bin/env node
// Harness canary reporter: one deduped GitHub issue per harness in
// davidcrowe/gatewaystack-connect.
//
//   canary-report.mjs --harness <id> --status <success|failure> --version <v>
//                     --run-url <url> [--failed-step <name>] [--log <file>] [--dry-run]
//
// Dedup: the open issue labelled `canary` + `harness:<id>` (and, as a
// belt-and-braces check, carrying the `<!-- harness-canary:<id> -->`
// marker in its body). Failure with no open issue -> create one. Failure
// with an open issue -> comment the run URL and version. Success with an
// open issue -> comment and close. Success with none -> nothing to do.
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

if (!["claude-code", "codex", "opencode"].includes(harness) || !["success", "failure"].includes(status)) {
  console.error("usage: canary-report.mjs --harness <claude-code|codex|opencode> --status <success|failure> ...");
  process.exit(2);
}
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

async function main() {
  const open = await findOpenIssue();
  if (status === "failure") {
    if (open) {
      await gh("POST", `/repos/${REPO}/issues/${open.number}/comments`, {
        body: `Still failing at step \`${failedStep}\`.\n\n${runLine}${logExcerpt()}`,
      });
      console.log(`updated #${open.number}`);
      return;
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
        "",
        harness === "opencode"
          ? "The canary installs the current released harness, installs ACP via the live installer with a seeded key, asserts the install invariants, pushes one governed `echo` through `opencode-acp run` (ACP's Gemini via the proxy) and asserts the audit row landed. A transcript containing `auto-rejecting` / `rejected permission` fails the governed-call step (gsc#1380); the audit rows in the window are printed with their `decision` so it can be classified. This issue is updated on every failing run and closed automatically on the next run where every step is green."
          : "The canary installs the current released harness, installs ACP via the live installer with a seeded key and asserts the install invariants (plugin/hook wired exactly once, launcher executable). This leg has no live governed call: that needs a vendor model key the canary does not carry. This issue is updated on every failing run and closed automatically on the next run where every step is green.",
        logExcerpt(),
      ].join("\n"),
    });
    console.log(`created ${created.html_url}`);
    return;
  }
  // success
  if (!open) { console.log("green, no open canary issue"); return; }
  await gh("POST", `/repos/${REPO}/issues/${open.number}/comments`, { body: `Green again. ${runLine}` });
  await gh("PATCH", `/repos/${REPO}/issues/${open.number}`, { state: "closed", state_reason: "completed" });
  console.log(`closed #${open.number}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
