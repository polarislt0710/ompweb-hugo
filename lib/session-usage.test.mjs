import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getSessionUsageBreakdown, listSubagentTranscripts } = await jiti.import("./session-usage.ts");

function assistant({ provider, model, input = 0, cacheRead = 0, output = 10, cost, promptTokens, tools = [] }) {
  return JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      provider,
      model,
      content: tools.map((name) => ({ type: "toolCall", name, arguments: {} })),
      usage: { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: { total: cost } },
      contextSnapshot: { promptTokens },
    },
  });
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-session-usage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, "2026-09-16T00-00-00_parent.jsonl");
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "session", version: 3, id: "parent", cwd: "/work" }),
    assistant({ provider: "openai-codex", model: "gpt-5.6-terra", input: 1000, cost: 1, promptTokens: 20_000, tools: ["task"] }),
    assistant({ provider: "openai-codex", model: "gpt-5.6-terra", cacheRead: 250_000, cost: 2, promptTokens: 250_000, tools: ["hub"] }),
    assistant({ provider: "openai-codex", model: "gpt-5.6-terra", cacheRead: 240_000, cost: 0.5, promptTokens: 240_000, tools: [] }),
  ].join("\n") + "\n");

  const artifacts = join(dir, "2026-09-16T00-00-00_parent");
  mkdirSync(artifacts);
  writeFileSync(join(artifacts, "1.bash.log"), "noise");
  writeFileSync(join(artifacts, "Worker.jsonl"), [
    JSON.stringify({ type: "session_init", agent: "worker", resolvedModel: "deepseek/deepseek-flash:high" }),
    assistant({ provider: "deepseek", model: "deepseek-flash", input: 13_000, cost: 0.01, promptTokens: 13_000 }),
    assistant({ provider: "openai-codex", model: "gpt-5.6-terra", cacheRead: 30_000, cost: 0.2, promptTokens: 30_000 }),
  ].join("\n") + "\n");
  mkdirSync(join(artifacts, "Worker"));
  writeFileSync(join(artifacts, "Worker", "Scout.jsonl"), [
    JSON.stringify({ type: "session_init", agent: "scout", resolvedModel: "deepseek/deepseek-flash" }),
    assistant({ provider: "deepseek", model: "deepseek-flash", input: 9_000, cost: 0.003, promptTokens: 9_000 }),
  ].join("\n") + "\n");
  return sessionFile;
}

test("lists nested subagent transcripts and ignores artifact logs", (t) => {
  const sessionFile = fixture(t);
  const entries = listSubagentTranscripts(sessionFile).map(({ relPath, depth }) => [relPath, depth]).sort();
  assert.deepEqual(entries, [["Worker", 1], ["Worker/Scout", 2]]);
});

test("breaks a session into main context, wait-only turns and subagent spend", (t) => {
  const breakdown = getSessionUsageBreakdown(fixture(t));

  assert.equal(breakdown.main.turns, 3);
  assert.equal(breakdown.main.currentContextTokens, 240_000);
  assert.equal(breakdown.main.peakContextTokens, 250_000);
  assert.equal(breakdown.main.firstPromptTokens, 20_000);
  assert.equal(breakdown.main.waitOnlyTurns, 1);
  assert.equal(breakdown.main.waitOnlyCost, 2);
  assert.equal(breakdown.totals.subagentCount, 2);
  assert.ok(Math.abs(breakdown.totals.subagentCost - 0.213) < 1e-9);

  const [worker, scout] = breakdown.subagents;
  assert.equal(worker.id, "Worker");
  assert.equal(worker.agent, "worker");
  assert.equal(worker.resolvedModel, "deepseek/deepseek-flash");
  assert.equal(worker.fellBack, true, "a Terra turn after resolving DeepSeek is a fallback");
  assert.equal(worker.firstPromptTokens, 13_000);
  assert.equal(scout.path, "Worker/Scout");
  assert.equal(scout.fellBack, false);
});
