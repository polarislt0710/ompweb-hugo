import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseProviderUsageOutput, redactAccountLabel, sanitizeProviderUsageSnapshot } = await jiti.import("./provider-usage.ts");
test("parseProviderUsageOutput selects matching model windows", () => {
  const now = Date.UTC(2026, 7, 27, 12, 0, 0);
  const output = JSON.stringify({
    generatedAt: 123,
    reports: [
      {
        provider: "openai-codex",
        metadata: { email: "account@example.com", planType: "plus" },
        limits: [
          {
            scope: { modelId: "gpt-5.6-luna", windowId: "5h" },
            amount: { usedFraction: 0.09 },
            window: { resetsAt: now + (2 * 60 + 39) * 60_000 },
          },
          {
            scope: { modelId: "gpt-5.6-luna", windowId: "7d" },
            amount: { usedFraction: 0.04 },
            window: { resetsAt: now + (5 * 24 + 20) * 3_600_000 },
          },
          {
            scope: { modelId: "other-model", windowId: "5h" },
            amount: { usedFraction: 0.88 },
            window: { resetsAt: now + 60_000 },
          },
        ],
      },
      {
        provider: "ollama",
        limits: [
          {
            scope: { windowId: "5h" },
            amount: { usedFraction: 0.5 },
            window: { resetsAt: now + 60_000 },
          },
        ],
      },
    ],
  });

  assert.deepEqual(parseProviderUsageOutput(output, { provider: "openai-codex", modelId: "GPT-5.6-LUNA" }, now), {
    generatedAt: 123,
    reports: [{
      provider: "openai-codex",
      accountLabel: "account@example.com",
      plan: "plus",
      modelId: "gpt-5.6-luna",
      fiveHour: { percent: 9, resetMinutes: 159 },
      sevenDay: { percent: 4, resetHours: 140 },
    }],
  });
});

test("parseProviderUsageOutput selects the binding meter for repeated windows", () => {
  const now = 1_000_000;
  const output = JSON.stringify({
    reports: [{
      provider: "provider",
      limits: [
        { scope: { modelId: "model", windowId: "5h" }, amount: { usedFraction: 0.1 }, window: { resetsAt: now + 60_000 } },
        { scope: { modelId: "model", windowId: "5h" }, amount: { usedFraction: 0.7 }, window: { resetsAt: now + 30 * 60_000 } },
      ],
    }],
  });

  assert.deepEqual(parseProviderUsageOutput(output, { provider: "provider" }, now).reports[0]?.fiveHour, {
    percent: 70,
    resetMinutes: 30,
  });
});
test("parseProviderUsageOutput returns every model when no model is selected", () => {
  const output = JSON.stringify({
    reports: [{
      provider: "provider",
      metadata: { accountId: "account-1" },
      limits: [
        { scope: { modelId: "model-a", windowId: "5h" }, amount: { usedFraction: 0.1 }, window: {} },
        { scope: { modelId: "model-a", windowId: "7d" }, amount: { usedFraction: 0.2 }, window: {} },
        { scope: { modelId: "model-b", windowId: "5h" }, amount: { usedFraction: 0.3 }, window: {} },
      ],
    }],
  });

  assert.deepEqual(parseProviderUsageOutput(output, { provider: "provider" }), {
    generatedAt: null,
    reports: [
      {
        provider: "provider",
        accountLabel: "account-1",
        modelId: "model-a",
        fiveHour: { percent: 10 },
        sevenDay: { percent: 20 },
      },
      {
        provider: "provider",
        accountLabel: "account-1",
        modelId: "model-b",
        fiveHour: { percent: 30 },
      },
    ],
  });
});

test("parseProviderUsageOutput keeps accounts without reported limits", () => {
  const output = JSON.stringify({
    reports: [{ provider: "ollama", metadata: { email: "ollama@example.com" }, limits: [] }],
  });

  assert.deepEqual(parseProviderUsageOutput(output), {
    generatedAt: null,
    reports: [{
      provider: "ollama",
      accountLabel: "ollama@example.com",
      noLimits: true,
    }],
  });
});

test("parseProviderUsageOutput falls back to duration and ignores malformed limits", () => {
  const now = 1_000_000;
  const output = JSON.stringify({
    generatedAt: "not-a-number",
    reports: [{
      provider: "provider",
      limits: [
        {
          scope: {},
          amount: { usedFraction: 0.12 },
          window: { durationMs: 30 * 24 * 60 * 60 * 1000, resetsAt: now + 48 * 3_600_000 },
        },
        { scope: { windowId: "5h" }, amount: { usedFraction: "bad" }, window: {} },
        { scope: { windowId: "unknown" }, amount: { usedFraction: 0.2 }, window: {} },
      ],
    }],
  });

  assert.deepEqual(parseProviderUsageOutput(output, { provider: "provider" }, now), {
    generatedAt: null,
    reports: [{
      provider: "provider",
      accountIndex: 1,
      monthly: { percent: 12, resetHours: 48 },
    }],
  });
});

test("parseProviderUsageOutput rejects invalid JSON", () => {
  assert.throws(() => parseProviderUsageOutput("not-json"), /invalid JSON/);
});

test("redactAccountLabel keeps four letters so two accounts are not both hu*", () => {
  assert.equal(redactAccountLabel("hugong0412@gmail.com"), "hugo*");
  assert.equal(redactAccountLabel("couplethings0710@gmail.com"), "coup*");
  assert.equal(redactAccountLabel("polarislt0710@gmail.com"), "pola*");
  assert.equal(redactAccountLabel("hu*"), "hu*");
  assert.equal(redactAccountLabel("ab"), "ab*");
});

test("parseProviderUsageOutput maps weekly windows and splits Antigravity vendor meters", () => {
  const output = JSON.stringify({
    reports: [{
      provider: "google-antigravity",
      metadata: { email: "polarislt0710@gmail.com" },
      limits: [
        { label: "Usage (Google)", scope: { windowId: "weekly" }, amount: { usedFraction: 0.021 }, window: { durationMs: 604800000 } },
        { label: "Usage (Google)", scope: { windowId: "5h" }, amount: { usedFraction: 0 }, window: { durationMs: 18000000 } },
        { label: "Usage (Anthropic)", scope: { windowId: "weekly", shared: true }, amount: { usedFraction: 0 }, window: { durationMs: 604800000 } },
        { label: "Usage (OpenAI)", scope: { windowId: "weekly", shared: true }, amount: { usedFraction: 0 }, window: { durationMs: 604800000 } },
      ],
    }],
  });
  const reports = parseProviderUsageOutput(output, {}, 1_700_000_000_000).reports;
  assert.deepEqual(reports.map((report) => [report.meterLabel ?? "", Math.round(report.sevenDay?.percent ?? -1)]), [
    ["Google", 2],
    ["Anthropic", 0],
    ["OpenAI", 0],
  ]);
  assert.equal(reports[0]?.fiveHour?.percent, 0);
});

test("parseProviderUsageOutput tags Spark / Fable / Reserve meters", () => {
  const output = JSON.stringify({
    reports: [{
      provider: "openai-codex",
      metadata: { email: "hugong0412@gmail.com" },
      limits: [
        { scope: { windowId: "7d" }, amount: { usedFraction: 0.94 }, window: {} },
        { scope: { modelId: "GPT-5.3-Codex-Spark", windowId: "7d", tier: "spark" }, amount: { usedFraction: 0 }, window: {} },
        { scope: { modelId: "gpt-reserve", windowId: "7d", tier: "base-model-inference" }, amount: { usedFraction: 0 }, window: {} },
        { scope: { windowId: "7d", tier: "fable" }, amount: { usedFraction: 0.22 }, window: {} },
      ],
    }],
  });
  const reports = parseProviderUsageOutput(output).reports;
  assert.deepEqual(reports.map((report) => [report.accountLabel, report.meterLabel ?? ""]), [
    ["hugong0412@gmail.com", ""],
    ["hugong0412@gmail.com", "Spark"],
    ["hugong0412@gmail.com", "Reserve"],
    ["hugong0412@gmail.com", "Fable"],
  ]);
  assert.deepEqual(
    sanitizeProviderUsageSnapshot({ generatedAt: null, reports }).reports.map((report) => [report.accountLabel, report.meterLabel ?? ""]),
    [
      ["hugo*", ""],
      ["hugo*", "Spark"],
      ["hugo*", "Reserve"],
      ["hugo*", "Fable"],
    ],
  );
});
