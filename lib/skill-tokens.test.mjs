import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname.replace(/\/$/, "") } });
const {
  allPromptSkillNames,
  composeSkillPrompt,
  insertSkillToken,
  mentionsSkillToken,
  parsePromptSegments,
  removeSkillToken,
} = await jiti.import("./skill-tokens.ts");

test("inserts a skill token at the cursor without replacing existing text", () => {
  const atEnd = insertSkillToken("hello world", "plan");
  assert.equal(atEnd.text, "hello world {{skill:plan}}");
  const middle = insertSkillToken("hello world", "plan", 5);
  assert.equal(middle.text, "hello {{skill:plan}} world");
});

test("keeps multiple distinct skills", () => {
  const first = insertSkillToken("ship it", "plan", 0);
  const second = insertSkillToken(first.text, "explain", first.cursor);
  assert.match(second.text, /\{\{skill:plan\}\}/);
  assert.match(second.text, /\{\{skill:explain\}\}/);
  assert.deepEqual(allPromptSkillNames(second.text), ["plan", "explain"]);
});

test("does not duplicate an already inserted skill", () => {
  const once = insertSkillToken("hello", "plan");
  const twice = insertSkillToken(once.text, "plan", 0);
  assert.equal(twice.text, once.text);
});

test("composeSkillPrompt expands a single slash skill and keeps extras", () => {
  const text = "{{skill:plan}} make a title card {{skill:hyperframes}}";
  const outgoing = composeSkillPrompt(text);
  assert.match(outgoing, /^\/plan /);
  assert.match(outgoing, /use active skills: hyperframes/);
  assert.match(outgoing, /make a title card/);
});

test("composeSkillPrompt lists multiple slash skills without dropping one", () => {
  const outgoing = composeSkillPrompt("{{skill:plan}} {{skill:grill}} what now");
  assert.match(outgoing, /use active skills: plan, grill/);
  assert.doesNotMatch(outgoing, /^\/plan /);
});

test("removeSkillToken leaves other skills and the prose", () => {
  const text = "hello {{skill:plan}} {{skill:explain}} world";
  assert.equal(removeSkillToken(text, "plan").includes("{{skill:plan}}"), false);
  assert.match(removeSkillToken(text, "plan"), /\{\{skill:explain\}\}/);
  assert.match(removeSkillToken(text, "plan"), /hello/);
});

test("parsePromptSegments splits chips and text", () => {
  const segments = parsePromptSegments("ab{{skill:plan}}cd");
  assert.deepEqual(segments, [
    { type: "text", value: "ab" },
    { type: "skill", name: "plan" },
    { type: "text", value: "cd" },
  ]);
  assert.equal(mentionsSkillToken("ab{{skill:plan}}cd", "plan"), true);
});
