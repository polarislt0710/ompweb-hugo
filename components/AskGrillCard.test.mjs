import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AskGrillCard } = await jiti.import("./AskGrillCard.tsx");

function renderAsk(questions) {
  return renderToStaticMarkup(
    React.createElement(AskGrillCard, {
      request: {
        type: "extension_ui_request",
        id: "ask-1",
        method: "ask",
        questions,
      },
      onRespond() {},
      attached: true,
    }),
  );
}

test("always shows a custom answer textarea", () => {
  const html = renderAsk([
    {
      id: "q1",
      question: "Which vibe?",
      options: [{ label: "Quiet night" }, { label: "Busy kitchen" }, { label: "Other" }],
    },
  ]);
  assert.match(html, /<textarea/);
  assert.match(html, /Something else/);
  assert.doesNotMatch(html, />Other</);
});

test("multi questions use checkboxes and keep multiple selections visible", () => {
  const html = renderAsk([
    {
      id: "q2",
      question: "Select all that apply",
      options: [{ label: "Soup" }, { label: "Salad" }],
      multi: true,
    },
  ]);
  assert.match(html, /role="checkbox"/);
  assert.match(html, /Select all that apply/);
  assert.doesNotMatch(html, /role="radio"/);
});
