import assert from "node:assert/strict";
import test from "node:test";
import {
  composerModeSlashLine,
  isComposerMode,
  toggleComposerMode,
} from "./composer-modes.ts";

test("composer modes are a closed set", () => {
  assert.equal(isComposerMode("flow"), true);
  assert.equal(isComposerMode("ask-matt"), true);
  assert.equal(isComposerMode("grill-me"), false);
  assert.equal(isComposerMode(""), false);
});

test("toggling the active mode turns it off", () => {
  assert.equal(toggleComposerMode("off", "flow"), "flow");
  assert.equal(toggleComposerMode("flow", "flow"), "off");
  assert.equal(toggleComposerMode("plan", "grill"), "grill");
});

test("slash line is null when mode is off", () => {
  assert.equal(composerModeSlashLine("off", "add dark mode"), null);
  assert.equal(composerModeSlashLine("flow", "add dark mode"), "/flow add dark mode");
  assert.equal(composerModeSlashLine("grill", "what should this be"), "/grill what should this be");
  assert.equal(composerModeSlashLine("ask-matt", "stuck"), "/ask-matt stuck");
  assert.equal(composerModeSlashLine("plan", "ship export"), "/plan ship export");
});
