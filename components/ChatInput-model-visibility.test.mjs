import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

function installDomStubs(initial) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
  globalThis.Event = globalThis.Event ?? class { constructor(type) { this.type = type; } };
  globalThis.window = { dispatchEvent() {} };
  return store;
}

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const {
  COMPOSER_HIDDEN_MODELS_STORAGE_KEY,
  COMPOSER_MODELS_STORAGE_KEY,
  migrateVisibleModelKeys,
  readHiddenModelKeys,
} = await jiti.import("./ChatInput-model-options.ts");

const ALL = ["anthropic:claude-opus-5", "zhipu-coding-plan:glm-5.3", "deepseek:deepseek-flash"];

test("a legacy allowlist becomes the equivalent hide-list", () => {
  const store = installDomStubs({
    [COMPOSER_MODELS_STORAGE_KEY]: JSON.stringify(["anthropic:claude-opus-5"]),
  });

  const hidden = migrateVisibleModelKeys(ALL);

  // Models the allowlist covered stay visible; the rest keep their hidden state.
  assert.ok(hidden);
  assert.equal(hidden.has("anthropic:claude-opus-5"), false);
  assert.equal(hidden.has("zhipu-coding-plan:glm-5.3"), true);
  assert.equal(store.has(COMPOSER_MODELS_STORAGE_KEY), false);
  assert.deepEqual([...readHiddenModelKeys()].sort(), ["deepseek:deepseek-flash", "zhipu-coding-plan:glm-5.3"]);
});

test("a provider omp gains after the migration is visible by default", () => {
  installDomStubs({
    [COMPOSER_HIDDEN_MODELS_STORAGE_KEY]: JSON.stringify(["anthropic:claude-opus-5"]),
  });

  assert.equal(migrateVisibleModelKeys([...ALL, "xai-oauth:grok-5"]), null);
  const hidden = readHiddenModelKeys();
  assert.equal(hidden.has("xai-oauth:grok-5"), false);
  assert.equal(hidden.has("zhipu-coding-plan:glm-5.3"), false);
});

test("migration waits for a non-empty runtime list", () => {
  const store = installDomStubs({
    [COMPOSER_MODELS_STORAGE_KEY]: JSON.stringify(["anthropic:claude-opus-5"]),
  });

  // Migrating against an empty list would file every model as hidden.
  assert.equal(migrateVisibleModelKeys([]), null);
  assert.equal(store.has(COMPOSER_MODELS_STORAGE_KEY), true);
});

test("no stored preference means nothing is hidden", () => {
  installDomStubs({});
  assert.equal(migrateVisibleModelKeys(ALL), null);
  assert.equal(readHiddenModelKeys().size, 0);
});
