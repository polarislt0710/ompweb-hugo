import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTPUT_STYLES,
  applyOutputStyle,
  getOutputStyle,
  isOutputStyleId,
} from "./output-styles.ts";

test("ships the daily-driver style set including ELI5, ELI15, and ladder", () => {
  const ids = OUTPUT_STYLES.map((style) => style.id);
  assert.deepEqual(ids, [
    "default",
    "adhd",
    "eli5",
    "eli15",
    "ladder",
    "concise",
    "caveman",
    "explanatory",
  ]);
});

test("default adds no wrapper", () => {
  assert.equal(applyOutputStyle("default", "fix the bug"), "fix the bug");
  assert.equal(applyOutputStyle("nope", "fix the bug"), "fix the bug");
});

test("named styles wrap the user message", () => {
  const wrapped = applyOutputStyle("eli15", "why does this rerender");
  assert.match(wrapped, /<output-style name="eli15">/);
  assert.match(wrapped, /smart 15-year-old/);
  assert.match(wrapped, /why does this rerender$/);
  assert.equal(isOutputStyleId("ladder"), true);
  assert.equal(getOutputStyle("caveman").id, "caveman");
});
