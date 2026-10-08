#!/usr/bin/env node
// SDK canary: @agenticcontrolplane/governance-anthropic (npm, latest). Wraps
// a `shell` handler with governHandlers() and dispatches it once under
// withContext({ userToken: key }); the governed wrapper runs PreToolUse ->
// handler -> PostToolUse against the canary workspace. A denied call comes
// back as "tool_error: <reason>" and still counts (the gateway decided); a
// fail-open lapse (cause in the reason, handler ran ungoverned) is a FAIL.
// Env: ACP_CANARY_KEY, MARKER, ACP_BASE_URL (optional).
//
// governance-anthropic re-exports governed/withContext/configure/getContext
// from @agenticcontrolplane/governance but NOT getConfig (0.2.1), so the
// version comes from the package manifest and the base URL from env.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { configure, governHandlers, withContext } from "@agenticcontrolplane/governance-anthropic";

const key = process.env.ACP_CANARY_KEY;
if (!key) { console.error("ACP_CANARY_KEY is not set"); process.exit(2); }
const marker = process.env.MARKER || `acp-canary-local-${Date.now()}`;
// The package "exports" map has no "./package.json" subpath (0.2.x), so
// require(".../package.json") throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve
// the allowed main entry, then walk up to the manifest on disk.
function pkgVersion() {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve("@agenticcontrolplane/governance-anthropic")));
    for (let i = 0; i < 6; i++, dir = dirname(dir)) {
      try {
        const m = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        if (m.name === "@agenticcontrolplane/governance-anthropic") return m.version || "unknown";
      } catch {}
    }
  } catch {}
  return "unknown";
}
const version = pkgVersion();
configure({ baseUrl: process.env.ACP_BASE_URL || "https://api.agenticcontrolplane.com", clientHeader: `acp-canary-sdk-governance-anthropic/${version}` });

let lapse = "";
const origWarn = console.warn;
console.warn = (...a) => { const s = a.join(" "); if (/UNGOVERNED/.test(s)) lapse = s; origWarn(...a); };

const handlers = governHandlers({ shell: async ({ command }) => `ran: ${command}` });
const result = await withContext({ userToken: key, agentTier: "api", agentName: "harness-canary" }, () =>
  handlers.shell({ command: `echo ${marker}` }));
console.log(JSON.stringify({ sdk: "governance-anthropic", version, result }));
if (lapse) { console.error(`FAIL handler ran without a gateway decision: ${lapse}`); process.exit(1); }
console.log(`ok   governance-anthropic dispatched shell echo ${marker} through governHandlers`);
