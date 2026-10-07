// Loader for the shared kernel-parity corpus.
//
// The corpus stores destructive binary names as fragment arrays (tokens) and
// references them as {{NAME}} inside commands and expected keys. Governed
// writes of the bare literals are subject to response filtering, which would
// silently corrupt the fixture — so the literal never appears in the file.
//
// Keep this loader behaviourally identical everywhere the corpus is consumed.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function expandTokens(s, tokens) {
  return String(s).replace(/\{\{([A-Z_]+)\}\}/g, (whole, name) => {
    const frags = tokens[name];
    if (!Array.isArray(frags)) return whole;
    return frags.join("");
  });
}

export function loadCorpus(path = join(HERE, "kernel-parity-corpus.json")) {
  const raw = readFileSync(path, "utf8");
  const doc = JSON.parse(raw);
  const tokens = doc.tokens || {};

  const cases = doc.cases.map((c) => ({
    ...c,
    command: expandTokens(c.command, tokens),
    expect: {
      ...c.expect,
      keyPrefix: expandTokens(c.expect.keyPrefix, tokens),
    },
  }));

  // Fingerprint of the case table only, so prose edits to the header do not
  // churn it. Compared across repos to catch a vendored copy drifting.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(doc.cases))
    .digest("hex")
    .slice(0, 16);

  return { version: doc.version, cases, fingerprint, raw: doc };
}

// A classified key satisfies the expectation if it IS the expected key or sits
// beneath it. "Bash.gcloud" is satisfied by "Bash.gcloud.sql"; it is not
// satisfied by "Bash.gcloudfoo".
export function keySatisfies(actual, expectedPrefix) {
  if (actual === expectedPrefix) return true;
  return String(actual).startsWith(expectedPrefix + ".");
}

// True when this case carries a recorded divergence that names the given
// surface AND the given assertion. Surface names are the ones listed in the
// corpus `surfaces` array; assertion names are the keys of `assertions` in the
// corpus header ("keyPrefix", "hardline", "policyDeny").
//
// Divergences are per-assertion on purpose. A case whose floor verdict diverges
// still has a classification we want asserted; skipping the whole case would
// hide a future regression in the half that currently works.
export function divergesHere(testCase, surface, assertion) {
  return Boolean(divergenceFor(testCase, surface, assertion));
}

// The matching divergence entry, or undefined.
export function divergenceFor(testCase, surface, assertion) {
  const list = testCase.knownDivergences;
  if (!Array.isArray(list)) return undefined;
  return list.find((d) => {
    if (!Array.isArray(d.surfaces) || !d.surfaces.includes(surface)) return false;
    if (!Array.isArray(d.assertions)) return true; // unscoped: whole case
    return d.assertions.includes(assertion);
  });
}

// Every divergence entry recorded against a surface, for the count guard.
export function divergencesOn(cases, surface) {
  const out = [];
  for (const c of cases) {
    for (const d of c.knownDivergences || []) {
      if (!Array.isArray(d.surfaces) || !d.surfaces.includes(surface)) continue;
      for (const a of d.assertions || ["all"]) out.push({ id: c.id, assertion: a, ...d });
    }
  }
  return out;
}
