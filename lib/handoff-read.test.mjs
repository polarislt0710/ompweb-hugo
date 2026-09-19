import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { readHandoffFiles, MAX_HANDOFF_FILE_BYTES } = await jiti.import("./handoff.ts");

function project(t, planText) {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-handoff-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".omp", "handoff"), { recursive: true });
  writeFileSync(join(dir, ".omp", "handoff", "plan.md"), planText);
  return dir;
}

test("a plan that fits is read whole and is not marked truncated", (t) => {
  const text = "# Plan\n\n## Tickets\n\n### T1: 一張票\n- agent: worker\n";
  const dir = project(t, text);
  const plan = readHandoffFiles(dir).find((f) => f.name === "plan.md");
  assert.equal(plan.content, text);
  assert.notEqual(plan.truncated, true);
});

test("an oversized plan says so instead of quietly losing its tail", (t) => {
  // 424 KiB of plan was read as 256 KiB, and the tickets in the missing 40%
  // came back as "depends on unknown ticket".
  const filler = "x".repeat(MAX_HANDOFF_FILE_BYTES + 1024);
  const dir = project(t, filler);
  const plan = readHandoffFiles(dir).find((f) => f.name === "plan.md");
  assert.equal(plan.truncated, true, "the caller must be able to tell");
  assert.ok(plan.content.length > 0);
});

test("the cut is by bytes, so multi-byte text is not mismeasured", (t) => {
  // Each of these is three bytes and one JS string unit: slicing by string
  // index against a byte budget cuts in the wrong place.
  const text = "課".repeat(MAX_HANDOFF_FILE_BYTES);
  const dir = project(t, text);
  const plan = readHandoffFiles(dir).find((f) => f.name === "plan.md");
  assert.equal(plan.truncated, true);
  assert.ok(Buffer.byteLength(plan.content, "utf8") <= MAX_HANDOFF_FILE_BYTES,
    "the kept content must fit the byte budget it was measured against");
});
