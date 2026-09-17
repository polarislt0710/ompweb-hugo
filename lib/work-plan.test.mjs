import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parsePlan } = await jiti.import("./work-plan.ts");
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
