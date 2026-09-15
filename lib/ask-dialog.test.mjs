import test from "node:test";
import assert from "node:assert/strict";
import {
  ASK_SELECT_OTHER,
  encodeAskSubmit,
  isAskMulti,
  isAskSelectDoneLabel,
  isAskSelectMulti,
  isAskSelectOtherLabel,
  isOtherOptionLabel,
  parseAskSelectTitle,
  questionHasAnswer,
  stashAskSelectCustom,
  takeAskSelectCustom,
  expandAskOptionMentions,
  matchAskAtToken,
  composeAskMultiCustom,
} from "./ask-dialog.ts";

const questions = [
  {
    id: "q1",
    question: "Which vibe?",
    options: [
      { label: "Quiet night" },
      { label: "Busy kitchen" },
    ],
    recommended: 0,
  },
  {
    id: "q2",
    question: "Anything else?",
    options: [{ label: "Soup" }, { label: "Salad" }],
    multi: true,
  },
];

test("encodeAskSubmit includes selected labels and custom text", () => {
  const raw = encodeAskSubmit(
    questions,
    { q1: [0], q2: [0, 1] },
    { q1: "  extra note  " },
  );
  const parsed = JSON.parse(raw);
  assert.equal(parsed.kind, "submit");
  assert.equal(parsed.results.length, 2);
  assert.deepEqual(parsed.results[0].selectedOptions, ["Quiet night"]);
  assert.equal(parsed.results[0].customInput, "extra note");
  assert.deepEqual(parsed.results[1].selectedOptions, ["Soup", "Salad"]);
  assert.equal(parsed.results[1].multi, true);
});

test("questionHasAnswer treats custom text as an answer", () => {
  assert.equal(questionHasAnswer(questions[0], {}, {}), false);
  assert.equal(questionHasAnswer(questions[0], { q1: [1] }, {}), true);
  assert.equal(questionHasAnswer(questions[0], {}, { q1: "something else" }), true);
});

test("isOtherOptionLabel covers reserved Other labels", () => {
  assert.equal(isOtherOptionLabel("Other"), true);
  assert.equal(isOtherOptionLabel("Other (type your own)"), true);
  assert.equal(isOtherOptionLabel("其他"), true);
  assert.equal(isOtherOptionLabel("其他答案"), true);
  assert.equal(isOtherOptionLabel("その他"), true);
  assert.equal(isOtherOptionLabel("Quiet night"), false);
});

test("isAskMulti honors the flag and infers from the prompt", () => {
  assert.equal(isAskMulti({ question: "Which vibe?", options: [], multi: true }), true);
  assert.equal(isAskMulti({ question: "Which vibe?", options: [], multi: "true" }), true);
  assert.equal(isAskMulti({ question: "Which vibe?", options: [], multi: false }), false);
  assert.equal(isAskMulti({ question: "Select all that apply", options: [] }), true);
  assert.equal(isAskMulti({ question: "可以揀多過一個主題", options: [] }), true);
  assert.equal(isAskMulti({ question: "Which vibe?", options: [] }), false);
});

test("rpc select fallback detects Other, Done, and multi", () => {
  assert.equal(isAskSelectOtherLabel(ASK_SELECT_OTHER), true);
  assert.equal(isAskSelectDoneLabel("✓ Done selecting"), true);
  assert.deepEqual(parseAskSelectTitle("(2 selected) Pick toppings"), {
    question: "Pick toppings",
    selectedCount: 2,
  });
  assert.equal(isAskSelectMulti("Pick toppings", ["Soup", "Salad", "✓ Done selecting"]), true);
  assert.equal(isAskSelectMulti("Which vibe?", ["Quiet", "Loud"]), false);
});

test("stashed custom text is consumed once", () => {
  stashAskSelectCustom("  typed answer  ");
  assert.equal(takeAskSelectCustom(), "typed answer");
  assert.equal(takeAskSelectCustom(), null);
});

test("expandAskOptionMentions turns @1 into the option text", () => {
  const labels = ["Keep the first plan", "Rewrite the copy"];
  assert.equal(
    expandAskOptionMentions("@1 但唔要動畫", labels),
    "「1. Keep the first plan」 但唔要動畫",
  );
  assert.equal(
    expandAskOptionMentions("@1 同 @2，改埋用處", labels),
    "「1. Keep the first plan」 同 「2. Rewrite the copy」，改埋用處",
  );
});

test("matchAskAtToken finds the @ token at the caret", () => {
  assert.deepEqual(matchAskAtToken("hello @1", 8), { start: 6, query: "1" });
  assert.equal(matchAskAtToken("email@x.com", 11), null);
});

test("composeAskMultiCustom lists every checked option", () => {
  const labels = ["Keep the first plan", "Rewrite the copy", "Other (type your own)"];
  assert.equal(
    composeAskMultiCustom(["Keep the first plan", "Rewrite the copy"], labels, "但唔要動畫"),
    "「1. Keep the first plan」\n「2. Rewrite the copy」\n但唔要動畫",
  );
});
