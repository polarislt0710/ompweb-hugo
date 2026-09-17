// Client-safe handoff constants (no fs imports).

export const HANDOFF_DIR = ".omp/handoff";
export const HANDOFF_FILES = ["plan.md", "status.md", "decisions.md"] as const;
export type HandoffFileName = (typeof HANDOFF_FILES)[number];
