// Client-safe handoff constants (no fs imports).

export const HANDOFF_DIR = ".omp/handoff";
export const HANDOFF_FILES = ["plan.md", "status.md", "decisions.md"] as const;

/**
 * Where a foreman writes its own run's verdicts, relative to HANDOFF_DIR.
 *
 * status.md is a single file that every foreman read, prepended to, and wrote
 * back whole. Two foremen doing that at once cannot both win: on 2026-09-19
 * three of them ran together and the last writer erased thirty-eight passing
 * tickets. Locking the file would only turn the lost write into a stall, so the
 * shared file is gone instead — each run owns a file in here and nobody edits
 * anyone else's. status.md stays as the older runs' record and is still read.
 */
export const STATUS_DIR = "status.d";
export type HandoffFileName = (typeof HANDOFF_FILES)[number];
