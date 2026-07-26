// Mirror-drift guard: the decide.mjs embedded in install.sh (written to
// ~/.acp/decide.mjs at install time) MUST be byte-identical to the standalone
// decide.mjs in this repo. If they drift, users run different logic than the
// tests validate. This is the local counterpart to the repo↔live mirror check
// in .github/workflows/mirror-drift.yml.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("install.sh embeds decide.mjs verbatim", () => {
  const sh = readFileSync(join(ROOT, "install.sh"), "utf8");
  const standalone = readFileSync(join(ROOT, "decide.mjs"), "utf8");
  const m = sh.match(/cat > "\$CONFIG_DIR\/decide\.mjs" << 'DECIDE'\n([\s\S]*?)\nDECIDE\n/);
  assert.ok(m, "could not find the embedded decide.mjs heredoc in install.sh");
  const embedded = m[1] + "\n";
  assert.equal(
    embedded,
    standalone,
    "install.sh's embedded decide.mjs has drifted from the standalone decide.mjs — re-sync them (they must be verbatim identical).",
  );
});
