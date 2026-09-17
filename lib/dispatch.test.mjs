import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const dir = mkdtempSync(join(tmpdir(), "ompweb-dispatch-"));
process.env.OMP_WEB_DISPATCH_STORE = join(dir, "dispatch.json");
test.after(() => rmSync(dir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createDispatchRequest, decideDispatchRequest, listDispatchState, readProjectPlan, validateDispatch } = await jiti.import("./dispatch.ts");
const { parsePlan } = await jiti.import("./work-plan.ts");

const PLAN = `# Plan: demo

## Tickets

### T1: one
- agent: worker-fast
- verify: npm test

### T2: two
- agent: worker
- depends: T1
- verify: npm test
`;

function project() {
  const cwd = mkdtempSync(join(tmpdir(), "ompweb-project-"));
  mkdirSync(join(cwd, ".omp/handoff"), { recursive: true });
  writeFileSync(join(cwd, ".omp/handoff/plan.md"), PLAN);
  return cwd;
}

test("reads the project plan and validates the ticket selection", () => {
  const cwd = project();
  test.after(() => rmSync(cwd, { recursive: true, force: true }));
  const { plan } = readProjectPlan(cwd);
  assert.deepEqual(plan.tickets.map((ticket) => ticket.id), ["T1", "T2"]);
  assert.deepEqual(validateDispatch(plan, undefined), ["T1", "T2"], "no selection runs the whole plan");
  assert.deepEqual(validateDispatch(plan, ["t2"]), ["T2"], "ids are case-insensitive");
  assert.throws(() => validateDispatch(plan, ["T9"]), /Unknown tickets: T9/);
  assert.throws(() => validateDispatch(parsePlan("## Tickets\n### T1: a\n- depends: T4\n"), undefined), /Plan has errors/);
});

test("approval requests are single-use and scoped to their project", async () => {
  const cwd = project();
  test.after(() => rmSync(cwd, { recursive: true, force: true }));
  const request = createDispatchRequest(cwd, ["T1"], "please run T1");
  assert.equal(request.status, "pending");
  assert.equal(request.kind, "dispatch");

  const state = listDispatchState(cwd);
  assert.deepEqual(state.requests.map((entry) => entry.id), [request.id]);
  assert.deepEqual(listDispatchState("/somewhere/else").requests, [], "other projects do not see it");

  const rejected = await decideDispatchRequest(request.id, false);
  assert.equal(rejected.request.status, "rejected");
  await assert.rejects(decideDispatchRequest(request.id, false), /already rejected/);
  await assert.rejects(decideDispatchRequest("missing", true), /not found/);
});

test("a message request carries the run it targets and skips ticket validation", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ompweb-project-"));
  test.after(() => rmSync(cwd, { recursive: true, force: true }));
  const request = createDispatchRequest(cwd, undefined, "skip T3", { kind: "message", runId: "run-1" });
  assert.equal(request.kind, "message");
  assert.equal(request.runId, "run-1");
  assert.deepEqual(request.ticketIds, [], "no plan is needed to message a foreman");
});
