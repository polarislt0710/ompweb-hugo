import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SkillCategoryBar, SkillSuggestionRow } = await jiti.import("./ChatInput-skill-catalog.tsx");

const t = (key) => key;
const skills = [
  { name: "plan", description: "write a plan", category: "dev", kind: "slash" },
  { name: "hyperframes", description: "video composition", category: "design", kind: "skill" },
  { name: "wait-what", description: "re-pitch", category: "daily", kind: "slash" },
];

test("category bar renders Dev, Design, and Daily", () => {
  const html = renderToStaticMarkup(
    React.createElement(SkillCategoryBar, {
      skills,
      pinnedNames: [],
      usage: {},
      isStreaming: false,
      onPickSkill() {},
      t,
    }),
  );
  assert.match(html, /aria-label="chatInput.skillCatDev"/);
  assert.match(html, /aria-label="chatInput.skillCatDesign"/);
  assert.match(html, /aria-label="chatInput.skillCatDaily"/);
});

test("suggestion row shows the use-active-skills label, solid pinned chips, and dotted suggestions", () => {
  const html = renderToStaticMarkup(
    React.createElement(SkillSuggestionRow, {
      skills,
      pinnedNames: ["plan"],
      suggestions: [skills[1]],
      armedName: null,
      isStreaming: false,
      onTogglePinned() {},
      onSuggestionClick() {},
      t,
    }),
  );
  assert.match(html, /chatInput\.(useActiveSkills|skillPinnedLabel)/);
  assert.match(html, /data-state="pinned"/);
  assert.match(html, />plan</);
  assert.match(html, /data-state="suggested"/);
  assert.match(html, />hyperframes</);
});
