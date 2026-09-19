import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readRunStates, dependentsOf, runLooksFinished, readCompletedTickets, readLatestStates } = await jiti.import("./dispatch-auto.ts");
const { parsePlan } = await jiti.import("./work-plan.ts");

function project(t, status) {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-auto-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".omp", "handoff"), { recursive: true });
  writeFileSync(join(dir, ".omp", "handoff", "status.md"), status);
  return dir;
}

test("reads the newest run, not the one below it", (t) => {
  const dir = project(t, `# Status

## Run 2026-09-19 (second)
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T150 | done | a.tsx | pass |
| T151 | blocked | — | fail: upstream API missing |

### Next
whatever

## Run 2026-09-18 (first)
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T145 | done | b.tsx | pass |
| T151 | done | stale row from the older run | pass |
`);
  const states = readRunStates(dir);
  assert.equal(states.get("T150"), "done");
  // The older section says T151 passed. The newest run is the one that counts.
  assert.equal(states.get("T151"), "blocked");
  assert.equal(states.get("T145"), undefined, "an older run's tickets must not leak in");
});

test("a ticket the table never mentions is not success", (t) => {
  // This is T111: the run claimed 12/12 while the table held eleven rows.
  const dir = project(t, `## Run now
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T110 | done | a | pass |
| T112 | done | b | pass |
`);
  const states = readRunStates(dir);
  assert.equal(states.get("T110"), "done", "the table must actually have been read");
  assert.equal(states.get("T111"), undefined);
  assert.notEqual(states.get("T111"), "done");
});

test("needs-decision and running are read as themselves", (t) => {
  const dir = project(t, `## Run now
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T1 | needs-decision | — | which of two token sets is authoritative |
| T2 | running | — | — |
| T3 | skipped | — | depends on T1 |
`);
  const states = readRunStates(dir);
  assert.equal(states.get("T1"), "needs-decision");
  assert.equal(states.get("T2"), "running");
  assert.equal(states.get("T3"), "skipped");
});

test("no status file yet is empty, not a pass", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-auto-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readRunStates(dir).size, 0);
});

test("a blocked ticket takes everything downstream of it with it", () => {
  const plan = parsePlan(`# Plan: chain

## Tickets

### T1: root
- agent: worker
- depends: none
- files: a.ts
- verify: true

### T2: needs the root
- agent: worker
- depends: T1
- files: b.ts
- verify: true

### T3: needs T2
- agent: worker
- depends: T2
- files: c.ts
- verify: true

### T4: unrelated
- agent: worker
- depends: none
- files: d.ts
- verify: true
`);
  const stuck = dependentsOf(plan, ["T1"]);
  // Transitive: T3 never names T1, but it cannot run either.
  assert.deepEqual([...stuck].sort(), ["T2", "T3"]);
  assert.equal(stuck.has("T4"), false, "unrelated work must still be allowed to run");
  assert.equal(dependentsOf(plan, []).size, 0);
});

test("a skipped ticket comes back once the thing it waited for lands", (t) => {
  // T129 was skipped because T128 was blocked. T128 later passed, so T129 is
  // owed a run — treating it as taken is how work vanishes from a plan.
  const dir = project(t, `## Run second
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T128 | done | case fixture added | pass |

## Run first
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T128 | blocked | — | fail: fixture missing |
| T129 | skipped | — | depends on T128 |
`);
  const latest = readRunStates(dir);
  assert.equal(latest.get("T128"), "done");
  assert.equal(latest.get("T129"), undefined, "the older run's skip is not this run's business");
});

test("a run is not judged before its foreman could have answered", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-auto-run-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, "{}");
  const now = Date.now();

  // Dispatched one minute ago: T157-T160 were written off at this age.
  assert.equal(runLooksFinished({ startedAt: now - 60_000, sessionFile }, now), false);

  // Older, but the session is still writing.
  assert.equal(runLooksFinished({ startedAt: now - 30 * 60_000, sessionFile }, now), false);

  // Older, and silent for long enough.
  const old = now - 30 * 60_000;
  utimesSync(sessionFile, new Date(old), new Date(old));
  assert.equal(runLooksFinished({ startedAt: old, sessionFile }, now), true);

  // A run whose session file never appeared has nothing to wait for.
  assert.equal(runLooksFinished({ startedAt: old, sessionFile: join(dir, "gone.jsonl") }, now), true);
});

test("finished means status.md said done, not merely that a run took it", (t) => {
  // T157 was dispatched and came back blocked; T158/T159 were skipped in the
  // same run. Counting "dispatched" as finished released T160, whose whole job
  // is to sign off that chain.
  const dir = project(t, `## Run second
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T161 | done | spec fixes | pass |

## Run first
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T156 | done | analytics wired | pass |
| T157 | blocked | — | fail: 5 of 8 |
| T158 | skipped | — | depends on T157 |
| T159 | skipped | — | depends on T158 |
`);
  const done = readCompletedTickets(dir);
  assert.deepEqual([...done].sort(), ["T156", "T161"]);
  assert.equal(done.has("T157"), false);
  assert.equal(done.has("T158"), false);
});

test("a ticket keeps its newest verdict, whichever section it is in", (t) => {
  const dir = project(t, `## Run third
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T157 | done | spec rewritten | pass |

## Run second
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T161 | done | diagnostics | pass |

## Run first
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T157 | blocked | — | fail: 5 of 8 |
| T125 | needs-decision | — | router does not exist |
`);
  const latest = readLatestStates(dir);
  // T157 failed once and passed later: the newest word wins.
  assert.equal(latest.get("T157"), "done");
  // T161 passed in a section that is not the newest — it is still done.
  assert.equal(latest.get("T161"), "done");
  // A verdict nothing has overturned still stands.
  assert.equal(latest.get("T125"), "needs-decision");
});
