import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { clampThinkingLevel, resolveAvailableThinkingLevels, selectableThinkingLevels, thinkingLevelsForMeta } = await jiti.import("./thinking-levels.ts");

const LUNA = { provider: "openai", modelId: "gpt-5.6-luna" };
const LIVE_LUNA = { provider: "openai", modelId: "gpt-5.6-luna", reasoning: true, thinking: { efforts: ["low", "medium", "high", "xhigh", "max"] } };
const LIVE_NON_REASONING = { provider: "openai", modelId: "gpt-4", reasoning: false };

test("catalog ladder wins for a known model", () => {
  assert.deepEqual(
    resolveAvailableThinkingLevels(["off", "low", "medium", "high"], LUNA, LIVE_LUNA),
    ["off", "low", "medium", "high"],
  );
});

test("catalog wins even when the live model differs (user just picked a model)", () => {
  const picked = { provider: "google-antigravity", modelId: "gemini-3-pro" };
  assert.deepEqual(
    resolveAvailableThinkingLevels(["off", "low", "high"], picked, LIVE_LUNA),
    ["off", "low", "high"],
  );
});

test("live model ladder backs a non-catalog model", () => {
  assert.deepEqual(
    resolveAvailableThinkingLevels(undefined, LUNA, LIVE_LUNA),
    ["low", "medium", "high", "xhigh", "max"],
  );
});

test("live non-reasoning model offers only off", () => {
  assert.deepEqual(
    resolveAvailableThinkingLevels(undefined, { provider: "openai", modelId: "gpt-4" }, LIVE_NON_REASONING),
    ["off"],
  );
});

test("live model with no efforts does not invent off", () => {
  const live = { provider: "custom", modelId: "m", reasoning: true, thinking: {} };
  assert.deepEqual(resolveAvailableThinkingLevels(undefined, { provider: "custom", modelId: "m" }, live), []);
});

test("null when the live model does not match the current model", () => {
  assert.equal(
    resolveAvailableThinkingLevels(undefined, { provider: "openai-codex", modelId: "gpt-5.6-sol" }, LIVE_LUNA),
    null,
  );
});

test("null when there is no live model", () => {
  assert.equal(resolveAvailableThinkingLevels(undefined, LUNA, null), null);
});

test("null when there is no model at all", () => {
  assert.equal(resolveAvailableThinkingLevels(undefined, null, LIVE_LUNA), null);
});

test("empty catalog array is treated as a miss (no levels)", () => {
  assert.deepEqual(resolveAvailableThinkingLevels([], LUNA, LIVE_LUNA), ["low", "medium", "high", "xhigh", "max"]);
});

test("thinkingLevelsForMeta does not invent off for reasoning models", () => {
  assert.deepEqual(thinkingLevelsForMeta({ provider: "x", modelId: "y", reasoning: true, thinking: { efforts: ["minimal", "low"] } }), ["minimal", "low"]);
  assert.deepEqual(thinkingLevelsForMeta({ provider: "openai-codex", modelId: "gpt-6-astra", reasoning: true, thinking: { efforts: ["low", "medium", "high", "xhigh", "max"] } }), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(thinkingLevelsForMeta({ provider: "x", modelId: "y", reasoning: true, thinking: { efforts: ["none", "low"] } }), ["off", "low"]);
  assert.deepEqual(thinkingLevelsForMeta({ provider: "x", modelId: "y", reasoning: false }), ["off"]);
  assert.deepEqual(thinkingLevelsForMeta({ provider: "x", modelId: "y" }), ["off"]);
});

test("clampThinkingLevel drops off/none onto Astra's lowest real effort", () => {
  const astra = ["low", "medium", "high", "xhigh", "max"];
  assert.equal(clampThinkingLevel("off", astra), "low");
  assert.equal(clampThinkingLevel("none", astra), "low");
  assert.equal(clampThinkingLevel("minimal", astra), "low");
  assert.equal(clampThinkingLevel("high", astra), "high");
  assert.equal(clampThinkingLevel("auto", astra), "auto");
  assert.equal(clampThinkingLevel("off", null), "auto");
  assert.equal(clampThinkingLevel("high", null), "high");
});

test("selectable levels preserve provider-defined efforts outside the built-in UI ladder", () => {
  assert.deepEqual(
    selectableThinkingLevels(["off", "low", "ultra", "provider-max", "ultra"]),
    ["auto", "off", "low", "ultra", "provider-max"],
  );
});
