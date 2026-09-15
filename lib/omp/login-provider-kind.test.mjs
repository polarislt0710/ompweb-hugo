import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isSearchLoginProvider, loginProviderKind } = await jiti.import("./login-provider-kind.ts");

test("Perplexity OAuth is classified as search-only", () => {
  assert.equal(loginProviderKind("perplexity"), "search");
  assert.equal(isSearchLoginProvider("perplexity"), true);
});

test("chat OAuth providers stay model logins", () => {
  assert.equal(loginProviderKind("anthropic"), "models");
  assert.equal(loginProviderKind("openai-codex"), "models");
  assert.equal(loginProviderKind("xai-oauth"), "models");
  assert.equal(isSearchLoginProvider("google-antigravity"), false);
});
