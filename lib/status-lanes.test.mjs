// Concurrent lanes used to share status.md: each foreman read it, prepended its
// section and wrote the whole file back, so two at once lost one of the two.
// These tests pin the replacement — a file per run, read as a union.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { statusSources, readCompletedTickets, readLatestStates, readRunStates } =
  await jiti.import("./dispatch-auto.ts");
const { HANDOFF_DIR, STATUS_DIR } = await jiti.import("./handoff-paths.ts");
const { buildForemanPrompt } = await jiti.import("./dispatch-prompt.ts");
const { parsePlan, splitIntoLanes } = await jiti.import("./work-plan.ts");

function project(files) {
  const cwd = mkdtempSync(join(tmpdir(), "lanes-"));
  mkdirSync(join(cwd, HANDOFF_DIR, STATUS_DIR), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(cwd, HANDOFF_DIR, name), text);
  }
  return cwd;
}

const run = (stamp, rows) =>
  `## Run ${stamp}\n| Ticket | State | Files changed | Verify |\n|---|---|---|---|\n${rows}\n`;

test("two lanes writing at once both count as finished", () => {
  const cwd = project({
    "status.md": run("2026-09-19T01:00", "| T1 | done | a.ts | pass |"),
    [`${STATUS_DIR}/batch-011-t2.md`]: run("2026-09-20T21:00", "| T2 | done | b.ts | pass |"),
    [`${STATUS_DIR}/batch-011-t3.md`]: run("2026-09-20T21:00", "| T3 | done | c.ts | pass |"),
  });
  assert.deepEqual([...readCompletedTickets(cwd)].sort(), ["T1", "T2", "T3"]);
  rmSync(cwd, { recursive: true, force: true });
});

test("a lane's newer verdict outranks status.md's older one", () => {
  const cwd = project({
    "status.md": run("2026-09-19T01:00", "| T7 | blocked | — | fail: missing dep |"),
    [`${STATUS_DIR}/batch-012-t7.md`]: run("2026-09-20T21:00", "| T7 | done | d.ts | pass |"),
  });
  assert.equal(readLatestStates(cwd).get("T7"), "done");
  assert.ok(readCompletedTickets(cwd).has("T7"));
  rmSync(cwd, { recursive: true, force: true });
});

test("statusSources puts lane files ahead of status.md", () => {
  const cwd = project({
    "status.md": run("2026-09-19T01:00", "| T1 | done | a.ts | pass |"),
    [`${STATUS_DIR}/batch-011-t2.md`]: run("2026-09-20T21:00", "| T2 | done | b.ts | pass |"),
  });
  const sources = statusSources(cwd);
  assert.ok(sources[0].includes(STATUS_DIR), `expected a lane file first, got ${sources[0]}`);
  assert.ok(sources.at(-1).endsWith("status.md"));
  rmSync(cwd, { recursive: true, force: true });
});

test("readRunStates reads the newest run, not whatever is in status.md", () => {
  const cwd = project({
    "status.md": run("2026-09-19T01:00", "| T1 | done | a.ts | pass |"),
    [`${STATUS_DIR}/batch-013-t9.md`]: run("2026-09-20T21:00", "| T9 | needs-decision（停在基建停止點） | — | fail |"),
  });
  const states = readRunStates(cwd);
  assert.equal(states.get("T9"), "needs-decision");
  assert.equal(states.get("T1"), undefined, "T1 belongs to an older run");
  rmSync(cwd, { recursive: true, force: true });
});

test("a project with no status.d yet still reads status.md", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lanes-"));
  mkdirSync(join(cwd, HANDOFF_DIR), { recursive: true });
  writeFileSync(join(cwd, HANDOFF_DIR, "status.md"), run("2026-09-19T01:00", "| T1 | done | a.ts | pass |"));
  assert.deepEqual([...readCompletedTickets(cwd)], ["T1"]);
  rmSync(cwd, { recursive: true, force: true });
});

test("the foreman is told to write its own file and leave the others alone", () => {
  const plan = parsePlan("### T1: one\n- agent: worker\n- files: a.ts\n- verify: true\n");
  const prompt = buildForemanPrompt(plan, ["T1"], `${STATUS_DIR}/batch-011-t1.md`);
  assert.match(prompt, /status\.d\/batch-011-t1\.md is yours alone/);
  assert.match(prompt, /Do not open, read or write @\.omp\/handoff\/status\.md/);
});

test("a hand-started dispatch still uses the shared file", () => {
  const plan = parsePlan("### T1: one\n- agent: worker\n- files: a.ts\n- verify: true\n");
  assert.match(buildForemanPrompt(plan, ["T1"]), /@\.omp\/handoff\/status\.md is yours alone/);
});

test("the foreman is pointed at decisions.md as owner authority", () => {
  const plan = parsePlan("### T1: one\n- agent: worker\n- files: a.ts\n- verify: true\n");
  const prompt = buildForemanPrompt(plan, ["T1"]);
  assert.match(prompt, /@\.omp\/handoff\/decisions\.md if it exists/);
  // The narrow reading is the point: an owner answer about one ticket must not
  // be read as blanket permission for the next.
  assert.match(prompt, /silence there is not permission/);
  assert.match(prompt, /any entry in @\.omp\/handoff\/decisions\.md that names this ticket/);
});

test("a ticket is never split from a dependency in the same batch", () => {
  const plan = parsePlan([
    "### T120: independent backend",
    "- agent: worker",
    "- files: backend/papers.py",
    "- verify: true",
    "",
    "### T121: needs T120",
    "- agent: worker",
    "- depends: T120",
    "- files: frontend/page.tsx",
    "- verify: true",
    "",
  ].join("\n"));
  // Different files, so a file-collision split would put these in two lanes.
  const lanes = splitIntoLanes(plan, ["T120", "T121"], 3);
  const together = lanes.some((lane) => lane.includes("T120") && lane.includes("T121"));
  assert.ok(together, `T121 must ride with T120, got ${JSON.stringify(lanes)}`);
});
