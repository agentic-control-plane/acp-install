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

  // ── 2. the row itself carries the reason ───────────────────────────
  // Two things have been tried here and both were worse than nothing.
  // `{ click: "tbody tr" }` highlighted a row and opened no detail view at
  // all. `{ clickText: "Raw details" }` did open one — onto a truncated
  // base64 PNG payload, no classification, no rule. The collapsed row already
  // shows the intent, the risk badge and the reason ("Run a shell command /
  // MEDIUM / arbitrary shell access"), which is the actual argument. Let it
  // sit, and caption that, rather than expanding into noise.
  { dwell: 3200 },
  { scrollBy: 220, ms: 900 },
  { dwell: 2400 },

  // ── 3. the policy surface — CUT, deliberately ──────────────────────
  // This beat is not in the tour, and re-adding it needs a decision first.
  //
  // The Policies page opens on the rule-recommendation queue, and on this
  // workspace those cards read as candid internal notes: they name a person,
  // name internal hosts and repos, reference tickets, and one card explains a
  // verified policy-bypass path in our own product. Scrolling to the top does
  // not escape it — the queue IS the top of the page.
  //
  // Nothing there is a credential, so the mask has no opinion about it. It is
  // a judgment call about what belongs in public, and it belongs to whoever
  // owns the workspace, not to the rig. Film it on a workspace whose queue has
  // been read first, or after the page grows a view that leads with the
  // defaults-by-tier matrix instead.
  //
  //   { navClick: "Policies" }, { waitGone: "Loading" }, { dwell: 5200 },

  // ── 4. approvals: the queue, and what it is for ────────────────────
  // Note this queue may well be EMPTY when you record. That is honest and
  // fine — the tab counts (approved / rejected / expired) show it is real and
  // used, and the empty-state copy states the contract. Do not caption it as
  // "a human working the queue" unless a pending card is actually on screen.
  { navClick: "Approvals" },
  { waitGone: "Loading" },
  { dwell: 4600 },

  // ── 5. the money view ──────────────────────────────────────────────
  { navClick: "Activity" },
  { navClick: "Runs" },
  { waitGone: "Loading" },
  // The re-sort takes ~5s to land, so a 2s dwell here filmed the table still
  // sorted by STARTED — the opposite of what the caption says.
  { sortBy: "COST" },
  { dwell: 6000 },
  { click: "tbody tr a", ms: 1400 },
  { waitFor: "Cost X-ray" },
  { dwell: 3400 },
  // The per-step breakdown is the payoff of this whole section and it used to
  // get ~1.2s before the recording ended. Hold it.
  { scrollBy: 420, ms: 1200 },
  { dwell: 5000 },
];
