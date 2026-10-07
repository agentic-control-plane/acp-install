#!/usr/bin/env node
// SDK canary: @agenticcontrolplane/proxy (npm, latest). This SDK brokers
// vendor credentials through ACP's egress proxy; it has no tool-call shape,
// so the check is: matchVendor() recognises GitHub, and ONE acpFetch to a
// GitHub URL with ACP_API_KEY = the canary key gets a typed answer from the
// gateway. Connected (2xx), not connected (AcpProviderNotConnectedError
// with a connectUrl) and policy-denied all prove the egress answered with
// the canary identity; unauthorized and unreachable are FAILs.
// Env: ACP_CANARY_KEY, ACP_BASE_URL (optional).
import { acpFetch, configure, matchVendor, AcpPolicyDeniedError, AcpProviderNotConnectedError, AcpUnauthorizedError, AcpUnreachableError, AcpFeatureDisabledError } from "@agenticcontrolplane/proxy";

const key = process.env.ACP_CANARY_KEY;
if (!key) { console.error("ACP_CANARY_KEY is not set"); process.exit(2); }
process.env.ACP_API_KEY = key;
if (process.env.ACP_BASE_URL) { try { configure({ baseUrl: process.env.ACP_BASE_URL }); } catch {} }

const url = "https://api.github.com/user";
const vendor = matchVendor(url);
if (!vendor) { console.error("FAIL matchVendor did not recognise api.github.com"); process.exit(1); }
console.log(`ok   matchVendor(${url}) -> ${JSON.stringify(vendor).slice(0, 120)}`);

try {
  const r = await acpFetch(url);
  console.log(`ok   acpFetch answered ${r.status} through ACP's egress`);
} catch (e) {
  if (e instanceof AcpProviderNotConnectedError) { console.log(`ok   egress answered: provider not connected (connectUrl=${e.connectUrl ?? "n/a"})`); }
  else if (e instanceof AcpPolicyDeniedError) { console.log(`ok   egress answered: policy denied (${e.message})`); }
  else if (e instanceof AcpFeatureDisabledError) { console.log(`ok   egress answered: feature disabled for this workspace (${e.message})`); }
  else if (e instanceof AcpUnauthorizedError) { console.error(`FAIL egress rejected the canary key: ${e.message}`); process.exit(1); }
  else if (e instanceof AcpUnreachableError) { console.error(`FAIL egress unreachable: ${e.message}`); process.exit(1); }
  else { console.error(`FAIL unexpected error: ${e?.message ?? e}`); process.exit(1); }
}
