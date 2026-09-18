import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { unwrapSearchOutput, searchWeb } = await jiti.import("./web-search.ts");

const ESC = String.fromCharCode(27);

/** What `omp search` actually prints: a coloured box, wrapped to the terminal. */
const SAMPLE = [
  `${ESC}[38;5;242m╭─── ⌕ Web Search: Perplexity 3 sources ──────────────────────────╮${ESC}[39m`,
  `│ Query: HKDSE English Paper 3 format                             │`,
  `├─── Answer ──────────────────────────────────────────────────────┤`,
  `│ ${ESC}[38;5;215mPaper 3${ESC}[39m is Listening and Integrated Skills.[1][2]            │`,
  `│                                                                 │`,
  `├─── Sources ─────────────────────────────────────────────────────┤`,
  `│ ├─ 2027 HKDSE English Assessment Framework (hkeaa.edu.hk)       │`,
  `╰─────────────────────────────────────────────────────────────────╯`,
].join("\n");

test("unwraps the box and drops the colour codes", () => {
  const text = unwrapSearchOutput(SAMPLE);
  assert.ok(!text.includes(ESC), "escape sequences survived");
  assert.ok(!text.includes("│"), "box edges survived");
  assert.ok(text.includes("Query: HKDSE English Paper 3 format"));
  assert.ok(text.includes("Paper 3 is Listening and Integrated Skills.[1][2]"));
});

test("keeps the section labels so the sources stay identifiable", () => {
  const text = unwrapSearchOutput(SAMPLE);
  assert.match(text, /## Answer/);
  assert.match(text, /## Sources/);
  assert.ok(text.includes("hkeaa.edu.hk"));
});

test("hyperlink escapes are removed, not their text", () => {
  const link = `${ESC}]8;;https://hkeaa.edu.hk${ESC}\\HKEAA${ESC}]8;;${ESC}\\`;
  assert.equal(unwrapSearchOutput(`│ see ${link} today │`), "see HKEAA today");
});

test("an empty query is refused before anything is spawned", async () => {
  await assert.rejects(() => searchWeb("   "), /query is required/);
});

test("an over-long query is refused", async () => {
  await assert.rejects(() => searchWeb("x".repeat(401)), /at most 400/);
});
