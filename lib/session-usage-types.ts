// Shared shapes and thresholds for the per-session usage panel. No Node
// imports: the client panel imports this file.

/** Context size at which the panel starts recommending a handoff. */
export const CONTEXT_WARN_TOKENS = 100_000;
/** Context size at which the panel flags the session as expensive. */
export const CONTEXT_DANGER_TOKENS = 200_000;

export interface TranscriptUsage {
  turns: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Prompt size of the first assistant request (system prompt + assignment). */
  firstPromptTokens: number;
  /** Prompt size of the most recent assistant request. */
  currentContextTokens: number;
  peakContextTokens: number;
  /** Assistant turns whose tool calls were all hub (wait/send/jobs). */
  waitOnlyTurns: number;
  waitOnlyCost: number;
  /** Distinct `provider/model` values that actually answered. */
  models: string[];
}

export interface SubagentUsage extends TranscriptUsage {
  id: string;
  /** Path relative to the parent's artifacts dir, e.g. `Worker/Scout`. */
  path: string;
  depth: number;
  agent: string | null;
  /** Model omp resolved at spawn, without the thinking suffix. */
  resolvedModel: string | null;
  /** True when some turns ran on a model other than the resolved one. */
  fellBack: boolean;
}

export interface SessionUsageBreakdown {
  main: TranscriptUsage;
  subagents: SubagentUsage[];
  totals: {
    cost: number;
    mainCost: number;
    subagentCost: number;
    subagentCount: number;
  };
}
