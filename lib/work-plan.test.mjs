import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parsePlan, suggestDispatchBatch, DEFAULT_DISPATCH_BATCH, splitIntoLanes } = await jiti.import("./work-plan.ts");
const { buildForemanPrompt } = await jiti.import("./dispatch-prompt.ts");

const PLAN = `# Plan: Fix login

## Context
Next.js app. Do not touch billing/.

## Tickets

### T1: Add session check
- agent: worker
- depends: none
- files: lib/auth.ts, \`lib/auth.test.mjs\`
- verify: \`npm test -- lib/auth.test.mjs\`

Reject expired sessions.

### T2：Update copy
- agent: writer
- depends: T1
- files: locales/en.json

Change the error text.
`;

test("parses tickets, fields and context", () => {
  const plan = parsePlan(PLAN);
  assert.equal(plan.title, "Fix login");
  assert.equal(plan.context, "Next.js app. Do not touch billing/.");
  assert.deepEqual(plan.tickets.map((t) => [t.id, t.title, t.agent, t.depends, t.files, t.verify]), [
    ["T1", "Add session check", "worker", [], ["lib/auth.ts", "lib/auth.test.mjs"], "npm test -- lib/auth.test.mjs"],
    ["T2", "Update copy", "writer", ["T1"], ["locales/en.json"], null],
  ]);
  assert.match(plan.tickets[0].body, /^### T1: Add session check[\s\S]*Reject expired sessions\.$/);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.warnings, ["T2: no verify command"]);
});

test("reports missing tickets, unknown dependencies, duplicates and cycles", () => {
  assert.match(parsePlan("# Plan: empty\n").errors[0], /No tickets/);
  const bad = parsePlan("## Tickets\n### T1: a\n### T1: b\n- depends: T7\n- agent: wizard\n");
  assert.ok(bad.errors.includes("T1: duplicate ticket id"));
  assert.ok(bad.errors.includes("T1: depends on unknown ticket T7"));
  assert.ok(bad.warnings.includes('T1: unknown agent "wizard", the foreman will use worker'));
  const cycle = parsePlan("## Tickets\n### T1: a\n- depends: T2\n### T2: b\n- depends: T1\n");
  assert.deepEqual(cycle.errors, ["Dependency cycle: T1 → T2 → T1"]);
});

test("foreman prompt names the selected tickets and the failure rules", () => {
  const prompt = buildForemanPrompt(parsePlan(PLAN), ["T2"]);
  assert.match(prompt, /^派工：T2 · 計畫 @\.omp\/handoff\/plan\.md/);
  assert.match(prompt, /Never try a third time/);
  assert.match(prompt, /do not use the ask tool/);
  assert.match(prompt, /Never wait on hub/, "workers must not block on a parent that is waiting for them");
  assert.match(buildForemanPrompt(parsePlan(PLAN)), /^派工：T1, T2 · /);
});

test("a big plan is dispatched in batches, in plan order, without repeating a run", () => {
  const markdown = ["# Plan: big", "", "## Tickets", ""].concat(
    Array.from({ length: 30 }, (_, index) => [
      `### T${index + 1}: ticket ${index + 1}`,
      "- agent: worker",
      `- depends: ${index === 0 ? "none" : `T${index}`}`,
      "- files: a.ts",
      "- verify: true",
      "",
    ].join("\n")),
  ).join("\n");
  const plan = parsePlan(markdown);
  assert.equal(plan.tickets.length, 30);

  const first = suggestDispatchBatch(plan, []);
  assert.deepEqual(first, Array.from({ length: DEFAULT_DISPATCH_BATCH }, (_, index) => `T${index + 1}`));

  // The next press picks up where the last run stopped rather than starting over.
  const second = suggestDispatchBatch(plan, first);
  assert.equal(second[0], `T${DEFAULT_DISPATCH_BATCH + 1}`);
  assert.equal(second.length, DEFAULT_DISPATCH_BATCH);

  // Case does not matter, and the tail is whatever is left.
  const nearlyDone = plan.tickets.slice(0, 28).map((ticket) => ticket.id.toLowerCase());
  assert.deepEqual(suggestDispatchBatch(plan, nearlyDone), ["T29", "T30"]);
});

test("a batch never contains a ticket whose gate has not run", () => {
  // The real shape: a repair chain appended after the tickets it gates.
  const plan = parsePlan(`# Plan: gated

## Tickets

### T113: gated work
- agent: frontend
- depends: T160
- files: a.ts
- verify: true

### T114: gated work too
- agent: frontend
- depends: T113
- files: b.ts
- verify: true

### T159: repair
- agent: worker
- depends: none
- files: c.ts
- verify: true

### T160: the gate
- agent: reviewer
- depends: T159
- files: d.ts
- verify: true
`);
  // Position would offer T113 first; dependencies say the chain runs first.
  // T113 is held back even though there is room: its gate is only being run in
  // this batch, and an unattended loop must see the gate's verdict in status.md
  // before releasing what the gate protects.
  assert.deepEqual(suggestDispatchBatch(plan, [], 4), ["T159", "T160"]);
  assert.deepEqual(suggestDispatchBatch(plan, [], 1), ["T159"]);
  // Once the gate has actually passed, the work behind it is offered.
  assert.deepEqual(suggestDispatchBatch(plan, ["T159", "T160"], 2), ["T113", "T114"]);

  // A gate that came back blocked releases nothing behind it.
  assert.deepEqual(suggestDispatchBatch(plan, ["T159"], 4, { exclude: ["T160"] }), []);
});

test("two tickets that share a file never run at the same time", () => {
  const plan = parsePlan(`# Plan: lanes

## Tickets

### T1: page work
- agent: worker
- depends: none
- files: src/page.tsx, artifacts/a.json
- verify: true

### T2: also the page
- agent: worker
- depends: none
- files: src/page.tsx
- verify: true

### T3: elsewhere
- agent: worker
- depends: none
- files: backend/thing.py
- verify: true
`);
  const lanes = splitIntoLanes(plan, ["T1", "T2", "T3"], 3);
  const laneOf = (id) => lanes.findIndex((lane) => lane.includes(id));
  assert.equal(laneOf("T1"), laneOf("T2"), "tickets sharing src/page.tsx must share a lane");
  assert.notEqual(laneOf("T3"), laneOf("T1"), "unrelated work should run beside it");
  assert.deepEqual(lanes.flat().sort(), ["T1", "T2", "T3"], "no ticket may be dropped");
});

test("a listed directory owns the files under it", () => {
  const plan = parsePlan(`# Plan: dirs

## Tickets

### T1: shoots into the captures folder
- agent: worker
- depends: none
- files: artifacts/captures/
- verify: true

### T2: writes one capture
- agent: worker
- depends: none
- files: artifacts/captures/after-1440.png
- verify: true
`);
  const lanes = splitIntoLanes(plan, ["T1", "T2"], 3);
  assert.equal(lanes.length, 1, "a directory and a file inside it are the same file");
});

test("lanes are capped, and capping only makes a lane longer", () => {
  const body = [1, 2, 3, 4].map((n) => `### T${n}: independent ${n}
- agent: worker
- depends: none
- files: src/f${n}.ts
- verify: true
`).join("\n");
  const plan = parsePlan(`# Plan: many\n\n## Tickets\n\n${body}`);
  const lanes = splitIntoLanes(plan, ["T1", "T2", "T3", "T4"], 2);
  assert.equal(lanes.length, 2);
  assert.deepEqual(lanes.flat().sort(), ["T1", "T2", "T3", "T4"]);
  // Still safe: no path appears in two lanes.
  const files = lanes.map((lane) => new Set(lane.map((id) => `src/f${id.slice(1)}.ts`)));
  for (const f of files[0]) assert.equal(files[1].has(f), false);
});
