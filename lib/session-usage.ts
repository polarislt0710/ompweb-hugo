// Per-session token breakdown: the parent transcript plus every subagent
// transcript omp wrote into the parent's sibling artifacts directory.
//
// Built to answer "where did this session's quota go": how large the context
// is now, how much the parent spent only waiting on subagents, and which
// subagents ran on a different model than they resolved at spawn (fallback).

import { readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { readModelsConfig, type ModelsFileConfig } from "./omp/models-config";
import { forEachFileLineSync } from "./omp/session-files";
import { asNumber, asString, isRecord } from "./type-guards";
import { calculateUsageCost, resolveModelRates } from "./usage-rates";
import type { SessionUsageBreakdown, SubagentUsage, TranscriptUsage } from "./session-usage-types";

export { CONTEXT_DANGER_TOKENS, CONTEXT_WARN_TOKENS } from "./session-usage-types";
export type { SessionUsageBreakdown, SubagentUsage, TranscriptUsage } from "./session-usage-types";

/** Tools whose only purpose is messaging/waiting on other agents. */
const WAIT_ONLY_TOOLS = new Set(["hub"]);

const MAX_SUBAGENT_DEPTH = 3;

export interface TranscriptScan extends TranscriptUsage {
  agent: string | null;
  resolvedModel: string | null;
  sawFallbackFlag: boolean;
}

export function emptyUsage(): TranscriptScan {
  return {
    turns: 0,
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    firstPromptTokens: 0,
    currentContextTokens: 0,
    peakContextTokens: 0,
    waitOnlyTurns: 0,
    waitOnlyCost: 0,
    models: [],
    agent: null,
    resolvedModel: null,
    sawFallbackFlag: false,
  };
}

/** Same layout as subagent-history; kept local to avoid pulling in the session reader. */
function siblingDirForSession(sessionFilePath: string): string {
  return join(dirname(sessionFilePath), basename(sessionFilePath, ".jsonl"));
}

function stripThinkingSuffix(model: string): string {
  const colon = model.lastIndexOf(":");
  return colon > model.indexOf("/") ? model.slice(0, colon) : model;
}

/** Fold one JSONL line into the running scan. Exported for tests. */
export function scanTranscriptLine(scan: TranscriptScan, models: Set<string>, rawLine: string, modelsConfig: ModelsFileConfig): void {
  if (!rawLine || rawLine.length < 5) return;
  // Cheap prefilter: only three entry types matter and transcripts are large.
  if (!rawLine.includes('"assistant"') && !rawLine.includes('"session_init"') && !rawLine.includes('"model_change"')) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;

  if (parsed.type === "session_init") {
    scan.agent = asString(parsed.agent) ?? scan.agent;
    const resolved = asString(parsed.resolvedModel);
    if (resolved) scan.resolvedModel = stripThinkingSuffix(resolved);
    return;
  }
  if (parsed.type === "model_change") {
    if (parsed.resolvedModelIsFallback === true) scan.sawFallbackFlag = true;
    return;
  }
  if (parsed.type !== "message" || !isRecord(parsed.message) || parsed.message.role !== "assistant") return;

  const msg = parsed.message;
  const usage = isRecord(msg.usage) ? msg.usage : undefined;
  if (!usage) return;
  const provider = asString(msg.provider) ?? "unknown";
  const model = asString(msg.model) ?? "unknown";
  models.add(`${provider}/${model}`);

  const { cost } = calculateUsageCost(usage, resolveModelRates(provider, model, modelsConfig));
  scan.turns += 1;
  scan.cost += cost;
  scan.inputTokens += asNumber(usage.input) ?? 0;
  scan.outputTokens += asNumber(usage.output) ?? 0;
  scan.cacheReadTokens += asNumber(usage.cacheRead) ?? 0;
  scan.cacheWriteTokens += asNumber(usage.cacheWrite) ?? 0;

  const snapshot = isRecord(msg.contextSnapshot) ? msg.contextSnapshot : undefined;
  const promptTokens = asNumber(snapshot?.promptTokens)
    ?? (asNumber(usage.input) ?? 0) + (asNumber(usage.cacheRead) ?? 0) + (asNumber(usage.cacheWrite) ?? 0);
  if (scan.turns === 1) scan.firstPromptTokens = promptTokens;
  scan.currentContextTokens = promptTokens;
  scan.peakContextTokens = Math.max(scan.peakContextTokens, promptTokens);

  const toolNames = Array.isArray(msg.content)
    ? msg.content.filter((part) => isRecord(part) && part.type === "toolCall").map((part) => asString((part as Record<string, unknown>).name) ?? "")
    : [];
  if (toolNames.length > 0 && toolNames.every((name) => WAIT_ONLY_TOOLS.has(name))) {
    scan.waitOnlyTurns += 1;
    scan.waitOnlyCost += cost;
  }
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  scan: TranscriptScan;
}

declare global {
  var __ompSessionUsageCache: Map<string, CacheEntry> | undefined;
}

const MAX_CACHE_ENTRIES = 1000;

function scanTranscriptFile(filePath: string, modelsConfig: ModelsFileConfig): TranscriptScan {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return emptyUsage();
  }
  const cache = (globalThis.__ompSessionUsageCache ??= new Map());
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.scan;

  const scan = emptyUsage();
  const models = new Set<string>();
  try {
    forEachFileLineSync(filePath, (line) => scanTranscriptLine(scan, models, line, modelsConfig));
  } catch {
    // Keep what was read; a transcript being appended to can end mid-line.
  }
  scan.models = [...models];

  cache.delete(filePath);
  cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, scan });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return scan;
}

function toUsage(scan: TranscriptScan): TranscriptUsage {
  return {
    turns: scan.turns,
    cost: scan.cost,
    inputTokens: scan.inputTokens,
    outputTokens: scan.outputTokens,
    cacheReadTokens: scan.cacheReadTokens,
    cacheWriteTokens: scan.cacheWriteTokens,
    firstPromptTokens: scan.firstPromptTokens,
    currentContextTokens: scan.currentContextTokens,
    peakContextTokens: scan.peakContextTokens,
    waitOnlyTurns: scan.waitOnlyTurns,
    waitOnlyCost: scan.waitOnlyCost,
    models: scan.models,
  };
}

/**
 * Subagent transcripts under a parent session, depth-first. omp nests a
 * subagent's own subagents in that subagent's sibling directory.
 */
export function listSubagentTranscripts(sessionFilePath: string, maxDepth = MAX_SUBAGENT_DEPTH): Array<{ filePath: string; relPath: string; depth: number }> {
  const out: Array<{ filePath: string; relPath: string; depth: number }> = [];
  const walk = (parentFile: string, prefix: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(siblingDirForSession(parentFile), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const filePath = join(siblingDirForSession(parentFile), entry.name);
      const relPath = prefix ? `${prefix}/${basename(entry.name, ".jsonl")}` : basename(entry.name, ".jsonl");
      out.push({ filePath, relPath, depth });
      walk(filePath, relPath, depth + 1);
    }
  };
  walk(sessionFilePath, "", 1);
  return out;
}

export function getSessionUsageBreakdown(sessionFilePath: string): SessionUsageBreakdown {
  const modelsConfig = readModelsConfig();
  const main = toUsage(scanTranscriptFile(sessionFilePath, modelsConfig));

  const subagents: SubagentUsage[] = [];
  for (const { filePath, relPath, depth } of listSubagentTranscripts(sessionFilePath)) {
    const scan = scanTranscriptFile(filePath, modelsConfig);
    if (scan.turns === 0) continue;
    const fellBack = scan.sawFallbackFlag
      || (scan.resolvedModel !== null && scan.models.some((model) => model !== scan.resolvedModel));
    subagents.push({
      ...toUsage(scan),
      id: basename(filePath, ".jsonl"),
      path: relPath,
      depth,
      agent: scan.agent,
      resolvedModel: scan.resolvedModel,
      fellBack,
    });
  }
  subagents.sort((a, b) => b.cost - a.cost);

  const subagentCost = subagents.reduce((sum, sub) => sum + sub.cost, 0);
  return {
    main,
    subagents,
    totals: {
      cost: main.cost + subagentCost,
      mainCost: main.cost,
      subagentCost,
      subagentCount: subagents.length,
    },
  };
}
