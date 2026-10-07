#!/usr/bin/env node
// SDK canary: @agenticcontrolplane/governance (npm, latest). One governed
// tool-call check against the canary workspace: preToolUse("shell",
// { command: "echo <marker>" }) under withContext({ userToken: key }).
// Passes only on a REAL decision from the gateway (fail-open lapses carry
// their cause in the reason and are a FAIL here). Env: ACP_CANARY_KEY,
// MARKER, ACP_BASE_URL (optional). NODE_PATH points at the install dir.
import { configure, getConfig, preToolUse, withContext } from "@agenticcontrolplane/governance";

const key = process.env.ACP_CANARY_KEY;
if (!key) { console.error("ACP_CANARY_KEY is not set"); process.exit(2); }
const marker = process.env.MARKER || `acp-canary-local-${Date.now()}`;
const version = getConfig().clientHeader.split("/")[1] || "unknown";
configure({ baseUrl: process.env.ACP_BASE_URL || getConfig().baseUrl, clientHeader: `acp-canary-sdk-governance-js/${version}` });

const out = await withContext({ userToken: key, agentTier: "api", agentName: "harness-canary" }, () =>
  preToolUse("shell", { command: `echo ${marker}` }));
console.log(JSON.stringify({ sdk: "governance-js", version, decision: out.decision, allowed: out.allowed, reason: out.reason }));
if (/ungoverned|fail-open|not-configured|unreachable|gateway-error/i.test(out.reason)) {
  console.error(`FAIL no decision from the gateway: ${out.reason}`);
  process.exit(1);
}
if (!["allow", "deny", "ask"].includes(out.decision)) { console.error(`FAIL unexpected decision ${out.decision}`); process.exit(1); }
console.log(`ok   governance-js got decision=${out.decision} for shell echo ${marker}`);
