import assert from "node:assert/strict";
import test from "node:test";
import {
  incrementSkillUsage,
  skillUsageBoost,
  skillUsageCount,
} from "./skill-usage.ts";

test("incrementSkillUsage counts case-insensitively", () => {
  const once = incrementSkillUsage(["Plan"], {});
  const twice = incrementSkillUsage(["plan", "grill"], once);
  assert.equal(skillUsageCount(twice, "PLAN"), 2);
  assert.equal(skillUsageCount(twice, "grill"), 1);
  assert.equal(skillUsageCount(twice, "flow"), 0);
});

test("usage boost grows slowly so it cannot bury a strong intent match", () => {
  const light = skillUsageBoost({ plan: 2 }, "plan");
  const heavy = skillUsageBoost({ plan: 40 }, "plan");
  assert.ok(light > 0);
  assert.ok(heavy > light);
  assert.ok(heavy < 12);
});
