// Scene: Console tour — "what you actually get after the install".
//
// The install videos end at ~/.acp/audit.jsonl on one machine. This is the
// other half of the story and the one nobody has seen: connect a workspace
// and the same decisions become a shared console — every agent, every call,
// searchable, with the policy that produced each decision one click away.
//
// The argument this scene has to make in ~70 seconds:
//
//   1. every governed call from every agent lands in one log (allow/ask/deny)
//   2. a deny is not a dead end — it carries WHY: classification, source, rule
//   3. the policy that produced it is editable, and asks can become rules
//   4. approvals are a queue a human works, not a prompt someone missed
//   5. the money view: what the run cost, per step
//
// Nothing here is staged: it is the real console on a real workspace with
// real traffic. If a band looks thin, pick a workspace with more history —
// never dress up an empty one.
//
// NAVIGATION RULE (inherited): this scene pins a workspace with { tenant },
// so every move after that is { navClick } or a { click } on a row. A { goto }
// reloads and silently resets the workspace; the rig throws if you try.
//
// KNOWN ISSUE: deny rows render near-white in the dark theme
// (gatewaystack-connect#743). If that is still unfixed when this records,
// either shoot light theme or keep denies framed by the drill-in, not the
// list — the drill-in renders the reason as text, which is the point anyway.
//
// Usage:
//   node record-console.mjs scenes/console-tour.mjs --out console-tour
//   ACP_WORKSPACE=other node record-console.mjs scenes/console-tour.mjs

const BASE = "https://cloud.agenticcontrolplane.com";
const WORKSPACE = process.env.ACP_WORKSPACE || "dcroweua";

export const name = "console-tour";

export const viewport = { width: 1600, height: 900, deviceScaleFactor: 2 };

export const steps = [
  // ── setup (not recorded) ───────────────────────────────────────────
  { goto: `${BASE}/home` },
  { tenant: WORKSPACE },
  { waitGone: "Loading" },

  // ── recording starts: the home band ────────────────────────────────
  // Open on the shape of the thing — activity across agents, not one terminal.
  { record: true },
  { dwell: 2200 },
  { scrollBy: 300, ms: 1000 },
  { dwell: 1800 },

  // ── 1. the log: every call, every agent ────────────────────────────
  // "Activity" IS the live governed-call feed (newest first) — there is no
  // "Logs" sub-tab; "Runs" is the per-execution view used later.
  { navClick: "Activity" },
  { waitGone: "Loading" },
  { dwell: 2600 },
  // Scroll the rows: allow after allow, then the decisions that weren't.
  { scrollBy: 320, ms: 1100 },
  { dwell: 2200 },

  // ── 2. a deny, drilled in — the reason is the product ──────────────
  // Open a row and let its classification / source / reason sit on screen.
  { click: "tbody tr", ms: 1300 },
  { dwell: 3400 },
  { scrollBy: 260, ms: 900 },
  { dwell: 2600 },

  // ── 3. the policy that produced it ─────────────────────────────────
  { navClick: "Policies" },
  { waitGone: "Loading" },
  { dwell: 3000 },
  // The rule list: allow / ask / deny per tool, most-specific wins.
  { scrollBy: 340, ms: 1100 },
  { dwell: 2800 },

  // ── 4. approvals: the ask queue a human works ──────────────────────
  { navClick: "Approvals" },
  { waitGone: "Loading" },
  { dwell: 3000 },

  // ── 5. the money view ──────────────────────────────────────────────
  { navClick: "Activity" },
  { navClick: "Runs" },
  { waitGone: "Loading" },
  { sortBy: "COST" },
  { dwell: 2000 },
  { click: "tbody tr a", ms: 1400 },
  { waitFor: "Cost X-ray" },
  { dwell: 3000 },
  { scrollBy: 420, ms: 1200 },
  { dwell: 3200 },
];
