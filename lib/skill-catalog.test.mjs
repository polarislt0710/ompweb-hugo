import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname.replace(/\/$/, "") } });
const {
  classifySkill,
  formatPromptSkills,
  insertSkillIntoPrompt,
  mergeCatalogSkills,
  parsePromptSkills,
  promptMentionsSkill,
  removeSkillFromPrompt,
  scoreSkillForPrompt,
  skillsInCategory,
  suggestSkills,
} = await jiti.import("./skill-catalog.ts");

test("classifies workflow, design, and daily names", () => {
  assert.equal(classifySkill("plan"), "dev");
  assert.equal(classifySkill("grill-me"), "dev");
  assert.equal(classifySkill("hyperframes-animation"), "design");
  assert.equal(classifySkill("vimo-video-editing"), "design");
  assert.equal(classifySkill("imagine"), "design");
  assert.equal(classifySkill("wait-what"), "daily");
  assert.equal(classifySkill("pdf"), "daily");
  assert.equal(classifySkill("codebase-design", "refactor the module graph"), "dev");
});

test("merge keeps slash kind for workflow names that also exist as files", () => {
  const merged = mergeCatalogSkills([
    { name: "grill", description: "file skill grill", category: "dev", kind: "skill" },
    { name: "hyperframes", description: "video composition", category: "design", kind: "skill" },
  ]);
  const grill = merged.find((skill) => skill.name === "grill");
  const hyperframes = merged.find((skill) => skill.name === "hyperframes");
  assert.equal(grill?.kind, "slash");
  assert.equal(grill?.category, "dev");
  assert.equal(hyperframes?.kind, "skill");
  assert.equal(hyperframes?.category, "design");
  assert.ok(skillsInCategory(merged, "dev").some((skill) => skill.name === "plan"));
});

test("inserting a slash skill prefixes the prompt without sending", () => {
  assert.equal(insertSkillIntoPrompt("add dark mode", { name: "plan", kind: "slash" }), "/plan add dark mode");
  assert.equal(
    insertSkillIntoPrompt("/grill add dark mode", { name: "plan", kind: "slash" }),
    "/plan add dark mode",
  );
});

test("inserting a file skill adds a use-active-skills line", () => {
  const once = insertSkillIntoPrompt("make a title card", { name: "hyperframes", kind: "skill" });
  assert.equal(once, "use active skills: hyperframes\n\nmake a title card");
  const twice = insertSkillIntoPrompt(once, { name: "media-use", kind: "skill" });
  assert.equal(twice, "use active skills: hyperframes, media-use\n\nmake a title card");
  assert.equal(insertSkillIntoPrompt(twice, { name: "hyperframes", kind: "skill" }), twice);
});

test("slash plus file skill keeps the slash first", () => {
  const withPlan = insertSkillIntoPrompt("make a title card", { name: "plan", kind: "slash" });
  const withBoth = insertSkillIntoPrompt(withPlan, { name: "hyperframes", kind: "skill" });
  assert.equal(withBoth, "/plan make a title card\n\nuse active skills: hyperframes");
  const parsed = parsePromptSkills(withBoth);
  assert.equal(parsed.slash, "plan");
  assert.deepEqual(parsed.activeSkills, ["hyperframes"]);
  assert.equal(parsed.body, "make a title card");
  assert.equal(formatPromptSkills(parsed), withBoth);
});

test("promptMentionsSkill sees slash and active-skill lines", () => {
  assert.equal(promptMentionsSkill("/plan ship it", "plan"), true);
  assert.equal(promptMentionsSkill("use active skills: grill\n\nwhat now", "grill"), true);
  assert.equal(promptMentionsSkill("just a message", "plan"), false);
});

test("removing a skill leaves the rest of the prompt", () => {
  const text = "/plan make a title card\n\nuse active skills: hyperframes, media-use";
  const withoutHyper = removeSkillFromPrompt(text, { name: "hyperframes", kind: "skill" });
  assert.equal(withoutHyper, "/plan make a title card\n\nuse active skills: media-use");
  const withoutPlan = removeSkillFromPrompt(withoutHyper, { name: "plan", kind: "slash" });
  assert.equal(withoutPlan, "use active skills: media-use\n\nmake a title card");
});

test("suggestions wait for a real prompt and ignore already-inserted skills", () => {
  const skills = mergeCatalogSkills([
    { name: "hyperframes", description: "video motion composition", category: "design", kind: "skill" },
    { name: "wait-what", description: "re-pitch", category: "daily", kind: "slash" },
  ]);
  assert.deepEqual(suggestSkills("hi", skills), []);
  const video = suggestSkills("please edit this video motion sequence in hyperframes style", skills);
  assert.ok(video.some((skill) => skill.name === "hyperframes"));
  const already = suggestSkills(
    "use active skills: hyperframes\n\nplease edit this video motion sequence",
    skills,
  );
  assert.ok(!already.some((skill) => skill.name === "hyperframes"));
});

test("planning language boosts plan over unrelated skills", () => {
  const plan = { name: "plan", description: "write a plan", category: "dev", kind: "slash" };
  const pdf = { name: "pdf", description: "read pdf files", category: "daily", kind: "skill" };
  const prompt = "help me plan the architecture before we code";
  assert.ok(scoreSkillForPrompt(prompt, plan) > scoreSkillForPrompt(prompt, pdf));
});

test("Cantonese analysis prompts suggest plan without clicking a skill first", () => {
  const skills = mergeCatalogSkills([]);
  const prompt = "我想你幫我去分析而家成個結構係點樣，例如 tenant、account 等等。";
  const names = suggestSkills(prompt, skills).map((skill) => skill.name);
  assert.ok(names.includes("plan"), `expected plan in ${names.join(", ")}`);
  assert.ok(names.length >= 1);
});

test("substantial unmatched prompts still get fallback suggestions", () => {
  const skills = mergeCatalogSkills([]);
  const names = suggestSkills("幫我睇吓呢件事點處理比較穩陣", skills).map((skill) => skill.name);
  assert.ok(names.includes("plan") || names.includes("ask-matt") || names.includes("explain"));
});

test("category lists put the most used skill first", () => {
  const skills = mergeCatalogSkills([]);
  const ordered = skillsInCategory(skills, "dev", { review: 9, plan: 1 });
  assert.equal(ordered[0]?.name, "review");
  assert.ok(ordered.findIndex((skill) => skill.name === "plan") < ordered.findIndex((skill) => skill.name === "loop"));
});

test("frequent on-topic skills outrank unused on-topic skills in suggestions", () => {
  const skills = mergeCatalogSkills([]);
  const prompt = "我想你幫我去分析而家成個結構係點樣";
  const names = suggestSkills(prompt, skills, { usage: { explain: 12, plan: 1 } }).map((skill) => skill.name);
  assert.ok(names.includes("explain"));
  assert.ok(names.indexOf("explain") <= names.indexOf("plan") || !names.includes("plan"));
});

test("a favourite off-topic skill does not replace a strong prompt match", () => {
  const skills = mergeCatalogSkills([
    { name: "hyperframes", description: "video motion composition", category: "design", kind: "skill" },
  ]);
  const names = suggestSkills(
    "please edit this video motion sequence in hyperframes style",
    skills,
    { usage: { pdf: 80 } },
  ).map((skill) => skill.name);
  assert.ok(names.includes("hyperframes"));
  assert.ok(!names.includes("pdf"));
});
