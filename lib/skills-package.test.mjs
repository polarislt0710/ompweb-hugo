import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillsAddPackage, skillsAddArgs } from "./skills-package.ts";

test("parseSkillsAddPackage accepts skills.sh owner/repo@skill sources", () => {
  assert.deepEqual(parseSkillsAddPackage("openai/skills@pdf"), { source: "openai/skills", skill: "pdf" });
  assert.deepEqual(parseSkillsAddPackage("anthropics/skills@pdf"), { source: "anthropics/skills", skill: "pdf" });
  assert.deepEqual(parseSkillsAddPackage("anthropics/skills"), { source: "anthropics/skills" });
  assert.deepEqual(parseSkillsAddPackage("claude-office-skills/skills@pdf ocr extraction"), {
    source: "claude-office-skills/skills",
    skill: "pdf ocr extraction",
  });
});

test("parseSkillsAddPackage still accepts npm names and rejects flags", () => {
  assert.deepEqual(parseSkillsAddPackage("@acme/skill-pack"), { source: "@acme/skill-pack" });
  assert.deepEqual(parseSkillsAddPackage("frontend-design"), { source: "frontend-design" });
  assert.equal(parseSkillsAddPackage("--force"), null);
  assert.equal(parseSkillsAddPackage("openai/skills@pdf;rm"), null);
  assert.equal(parseSkillsAddPackage(""), null);
});

test("skillsAddArgs uses --skill for marketplace rows", () => {
  assert.deepEqual(
    skillsAddArgs({ source: "openai/skills", skill: "pdf" }, { global: true }),
    ["skills", "add", "openai/skills", "-y", "--agent", "universal", "--skill", "pdf", "-g"],
  );
});
