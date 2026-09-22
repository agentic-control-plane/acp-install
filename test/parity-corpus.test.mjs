// Runs the shared kernel-parity corpus against THIS repo's decide.mjs.
//
// The same corpus runs against claude-code-acp-plugin/bin/decide.mjs and
// against the gateway's classifier. A case that passes here and fails there is
// drift — which is exactly how acp-install#18/#19 survived about four weeks
// after gatewaystack-connect#516 fixed the same class server-side.
//
// Adding a case here without adding it to the other surfaces is not a fix.
// See davidcrowe/gatewaystack-connect#1316 and acp-install#36.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCorpus, keySatisfies, divergenceFor, divergencesOn } from "./fixtures/load-corpus.mjs";
import { classifyTool, hardlineFloor, decide } from "../decide.mjs";

const SURFACE = "acp-install:decide.mjs";
const { cases, fingerprint, version } = loadCorpus();

// Recorded divergences on THIS surface. Drive it to zero.
const EXPECTED_DIVERGENCES = 2;

test("corpus loads, is non-trivial, and its fingerprint is stable", () => {
  assert.equal(version, 1);
  assert.ok(cases.length >= 24, `expected at least 24 cases, got ${cases.length}`);
  // If this fails, the case table changed. That is allowed — update the value
  // here AND in every other surface that vendors the corpus, in the same
  // change, or the copies have drifted.
  assert.equal(fingerprint, "1dceec2ee129bee3");
});

const skipFor = (c, assertion) => {
  const d = divergenceFor(c, SURFACE, assertion);
  return d ? `known divergence (${d.issue}): ${d.detail}` : undefined;
};

for (const c of cases) {
  test(`[${c.id}] classification: ${c.expect.keyPrefix}`, { skip: skipFor(c, "keyPrefix") }, () => {
    const key = classifyTool(c.tool, { command: c.command });
    assert.ok(
      keySatisfies(key, c.expect.keyPrefix),
      `${c.id}: expected a key at or under "${c.expect.keyPrefix}", got "${key}"\n  command: ${c.command}\n  why: ${c.why}`,
    );
  });

  test(`[${c.id}] hardline floor: ${c.expect.hardline ? "DENY" : "no floor"}`, { skip: skipFor(c, "hardline") }, () => {
    const floor = hardlineFloor(c.tool, { command: c.command });
    const denied = floor !== null && floor !== undefined && floor !== false;
    assert.equal(
      denied,
      c.expect.hardline,
      `${c.id}: hardline floor expected ${c.expect.hardline ? "DENY" : "no deny"}, got ${JSON.stringify(floor)}\n  command: ${c.command}\n  why: ${c.why}`,
    );
  });

  if (c.expect.policyDeny) {
    test(`[${c.id}] policy deny on ${c.expect.keyPrefix}`, { skip: skipFor(c, "policyDeny") }, () => {
      const policy = { default: "allow", rules: { [c.expect.keyPrefix]: "deny" } };
      const d = decide(c.tool, { command: c.command }, policy, {});
      assert.equal(
        d.decision,
        "deny",
        `${c.id}: policy denying "${c.expect.keyPrefix}" must deny this command, got ${JSON.stringify(d)}\n  command: ${c.command}\n  why: ${c.why}`,
      );
    });
  }
}

test(`divergence count on ${SURFACE} is exactly ${EXPECTED_DIVERGENCES}`, () => {
  const recorded = divergencesOn(cases, SURFACE);
  const lines = recorded.map((d) => `  - ${d.id} [${d.assertion}] ${d.issue}: ${d.direction}`);
  assert.equal(
    recorded.length,
    EXPECTED_DIVERGENCES,
    `divergence count changed on ${SURFACE}.\n` +
      `If you FIXED one, lower EXPECTED_DIVERGENCES and drop it from the corpus.\n` +
      `If a NEW one appeared, that is a regression — do not raise the number to make this green.\n` +
      `Currently recorded:\n${lines.join("\n")}`,
  );
});
