import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SelectAskCard } = await jiti.import("./SelectAskCard.tsx");

test("rpc select fallback always shows a custom textarea", () => {
  const html = renderToStaticMarkup(
    React.createElement(SelectAskCard, {
      request: {
        type: "extension_ui_request",
        id: "sel-1",
        method: "select",
        title: "Which vibe?",
        options: ["Quiet night", "Busy kitchen", "Other (type your own)"],
      },
      onRespond() {},
      attached: true,
    }),
  );
  assert.match(html, /<textarea/);
  assert.match(html, /Something else/);
  assert.doesNotMatch(html, /Other \(type your own\)/);
});

test("rpc select fallback keeps a Continue button for multi instead of submitting on each click", () => {
  const html = renderToStaticMarkup(
    React.createElement(SelectAskCard, {
      request: {
        type: "extension_ui_request",
        id: "sel-2",
        method: "select",
        title: "(1 selected) Pick toppings",
        options: ["Soup", "Salad", "✓ Done selecting", "Other (type your own)"],
      },
      onRespond() {},
      attached: true,
    }),
  );
  assert.match(html, /role="checkbox"/);
  assert.match(html, /Select all that apply/);
  assert.match(html, /Continue/);
});
