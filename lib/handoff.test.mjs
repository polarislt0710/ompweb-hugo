import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { HandoffError, MAX_HANDOFF_FILE_BYTES, isHandoffFileName, readHandoffFiles, writeHandoffFile } = await jiti.import("./handoff.ts");

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-handoff-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("reads missing handoff files as empty and writes them under .omp/handoff", (t) => {
  const cwd = tempDir(t);
  assert.deepEqual(readHandoffFiles(cwd).map((f) => [f.name, f.exists]), [["plan.md", false], ["status.md", false], ["decisions.md", false]]);

  const written = writeHandoffFile(cwd, "status.md", "next: wire tests", () => true);
  assert.equal(written.relativePath, ".omp/handoff/status.md");
  assert.equal(readFileSync(join(cwd, ".omp/handoff/status.md"), "utf8"), "next: wire tests");
  assert.equal(readHandoffFiles(cwd).find((f) => f.name === "status.md").content, "next: wire tests");
});

test("only accepts the three known file names", () => {
  assert.equal(isHandoffFileName("plan.md"), true);
  assert.equal(isHandoffFileName("../plan.md"), false);
  assert.equal(isHandoffFileName("notes.md"), false);
});

test("rejects oversized notes and a handoff dir that resolves outside the project", (t) => {
  const cwd = tempDir(t);
  assert.throws(() => writeHandoffFile(cwd, "plan.md", "x".repeat(MAX_HANDOFF_FILE_BYTES + 1), () => true), HandoffError);

  const outside = tempDir(t);
  mkdirSync(join(cwd, ".omp"));
  symlinkSync(outside, join(cwd, ".omp", "handoff"), "dir");
  assert.throws(
    () => writeHandoffFile(cwd, "plan.md", "hi", (realDir) => realDir.startsWith(cwd)),
    (error) => error instanceof HandoffError && error.code === "access_denied",
  );
});
