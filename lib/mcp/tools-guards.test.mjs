import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { MCP_TOOLS } = await jiti.import("./tools.ts");

test("the new read-only tools are declared and marked read-only", () => {
  const byName = new Map(MCP_TOOLS.map((t) => [t.name, t]));
  for (const name of ["git_status", "git_log", "read_artifact", "list_tickets"]) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must be offered`);
    assert.equal(tool.annotations.readOnlyHint, true, `${name} must be read-only`);
  }
});

test("write_plan takes a plan_file so a second author does not land in plan.md", () => {
  const writePlan = MCP_TOOLS.find((t) => t.name === "write_plan");
  assert.ok(writePlan.inputSchema.properties.plan_file, "plan_file must be offered");
  // The reason matters more than the field: say it where the caller reads it.
  assert.match(writePlan.inputSchema.properties.plan_file.description, /plan\.md/);
});

test("read_artifact is described as evidence, not as a general file reader", () => {
  const tool = MCP_TOOLS.find((t) => t.name === "read_artifact");
  assert.match(tool.description, /artifacts\//);
  assert.equal(tool.inputSchema.required.includes("path"), true);
});
