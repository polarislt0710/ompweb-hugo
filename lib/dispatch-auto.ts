// Run the plan overnight.
//
// One batch at a time, unattended: when a run ends, read what the foreman wrote
// in status.md and decide whether the next batch may start. The owner is asleep,
// so the rules are the ones they gave, and nothing here guesses beyond them:
//
//   - every ticket done      → dispatch the next batch
//   - something blocked      → drop the tickets that depend on it, transitively,
//                              and carry on with the rest
//   - nothing left to carry  → stop and leave a reason to read in the morning
//
// A foreman already retries a failed ticket once by itself. Anything that
// survives that retry is a judgement call, and a judgement call waits for a
// person. This loop never reruns a ticket, never edits the plan, and never
// decides that a blocker does not matter.

import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from "fs";
import { join } from "path";
import { getAgentDir } from "./omp/paths";
import { listDispatchState, startDispatch, loadDispatchStore, type DispatchRun } from "./dispatch";
import { parsePlan, suggestDispatchBatch, DEFAULT_DISPATCH_BATCH, type ParsedPlan } from "./work-plan";
import { HANDOFF_DIR } from "./handoff-paths";

export type AutoStopReason =
  | "finished"
  | "blocked"
  | "limit"
  | "stopped"
  | "error";

export interface AutoEntry {
  at: number;
  text: string;
}

export interface AutoState {
  cwd: string;
  running: boolean;
  startedAt: number;
  batchesRun: number;
  maxBatches: number;
  batchSize: number;
  /**
   * The only tickets this loop may dispatch. A plan holds work that is not ready
   * to run — T1-T63 are kept as a record while the reviewer rewrites them — and
   * plan order alone would walk straight into it. Empty means the whole plan.
   */
  only: string[];
  /** Tickets this loop has given up on, and why. */
  abandoned: Array<{ id: string; reason: string }>;
  /**
   * Tickets a foreman skipped because something they needed had not landed.
   * They are neither done nor failed: once the thing they waited for lands,
   * they go back in the queue. Treating them as taken is how work silently
   * disappears from a plan.
   */
  skipped: string[];
  stopReason?: AutoStopReason;
  /**
   * The process driving the loop. It used to run inside the web server, where a
   * colleague saving a file hot-reloaded the module and silently took the timer
   * with it — the run then sat still for twenty-five minutes. A standalone
   * process claims the loop here, and the server stands down while it is alive.
   */
  owner?: { pid: number; startedAt: number };
  /** Bumped every tick, so a dead owner is obvious. */
  heartbeatAt?: number;
  log: AutoEntry[];
}

const CHECK_MS = 60_000;
const MAX_LOG = 200;

function statePath(): string {
  return process.env.OMP_WEB_AUTO_STORE || join(getAgentDir(), "ompweb-dispatch-auto.json");
}

export function readAutoState(): AutoState | null {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as AutoState;
  } catch {
    return null;
  }
}

function writeAutoState(state: AutoState): void {
  const target = statePath();
  const temporary = `${target}.${process.pid}.tmp`;
  state.log = state.log.slice(-MAX_LOG);
  writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temporary, target);
}

function note(state: AutoState, text: string): void {
  state.log.push({ at: Date.now(), text });
  writeAutoState(state);
}

// ---------------------------------------------------------------------------
// Reading what the foreman reported
// ---------------------------------------------------------------------------

export type TicketState = "done" | "blocked" | "skipped" | "needs-decision" | "running" | "unknown";

/**
 * The newest `## Run` section of status.md, as a ticket → state map.
 *
 * The foreman writes a markdown table and adds each new run above the last, so
 * the first section is this run. A ticket the table never mentions is `unknown`,
 * which counts against the run: a batch that quietly lost a ticket is exactly
 * what happened with T111, and it must not look like success.
 */
export function readRunStates(cwd: string): Map<string, TicketState> {
  const path = join(cwd, HANDOFF_DIR, "status.md");
  const states = new Map<string, TicketState>();
  if (!existsSync(path)) return states;
  const text = readFileSync(path, "utf8");
  // Anchored to the start of a line, because status.md may open with the run
  // heading rather than a title.
  const heading = /^## Run/gm;
  const first = heading.exec(text);
  if (!first) return states;
  const second = heading.exec(text);
  const section = text.slice(first.index, second ? second.index : undefined);

  for (const line of section.split("\n")) {
    const row = /^\|\s*(T\d+)\s*\|\s*([A-Za-z-]+)\s*\|/.exec(line.trim());
    if (!row) continue;
    const word = row[2].toLowerCase();
    const state: TicketState =
      word === "done" ? "done"
      : word === "blocked" ? "blocked"
      : word === "skipped" ? "skipped"
      : word.startsWith("needs") ? "needs-decision"
      : word === "running" ? "running"
      : "unknown";
    states.set(row[1].toUpperCase(), state);
  }
  return states;
}

/** Every ticket that cannot run because something it needs did not land. */
export function dependentsOf(plan: ParsedPlan, failed: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const queue = [...failed].map((id) => id.toUpperCase());
  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const ticket of plan.tickets) {
      if (out.has(ticket.id)) continue;
      if (!ticket.depends.map((d) => d.toUpperCase()).includes(id)) continue;
      out.add(ticket.id);
      queue.push(ticket.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;

function readPlan(cwd: string): ParsedPlan {
  return parsePlan(readFileSync(join(cwd, HANDOFF_DIR, "plan.md"), "utf8"));
}

function stop(state: AutoState, reason: AutoStopReason, text: string): void {
  state.running = false;
  state.stopReason = reason;
  note(state, text);
  if (timer) { clearInterval(timer); timer = null; }
}

/** A run is young enough that a foreman could not have reported yet. */
const START_GRACE_MS = 4 * 60_000;
/** How long a session file must be silent before its run counts as over. */
const SILENCE_MS = 5 * 60_000;

/**
 * Has this run finished?
 *
 * Not `dispatchRunState`: that asks an in-process session registry, which a
 * restarted server or a standalone loop does not share, so it calls every run
 * ended. That is how T157-T160 were dispatched at 12:47 and written off as
 * "missing from status.md" at 12:48, a minute later, before the foreman had
 * written a word. The session's own file is the evidence both processes can see:
 * an omp session appends to it as it works.
 */
export function runLooksFinished(run: Pick<DispatchRun, "startedAt" | "sessionFile">, now = Date.now()): boolean {
  if (now - run.startedAt < START_GRACE_MS) return false;
  if (!run.sessionFile) return true;
  try {
    return now - statSync(run.sessionFile).mtimeMs > SILENCE_MS;
  } catch {
    return true; // the session left nothing behind; there is nothing to wait for
  }
}

/** Is some other live process driving the loop? */
export function hasLiveOwner(state: AutoState | null): boolean {
  const owner = state?.owner;
  if (!owner || owner.pid === process.pid) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch {
    return false; // the owner is gone; whoever asks may take over
  }
}

/** One pass of the loop. Exported so a standalone process can drive it. */
export async function autoTick(): Promise<void> {
  return tick();
}

async function tick(): Promise<void> {
  const state = readAutoState();
  if (state && hasLiveOwner(state)) {
    // Another process owns this run; do not dispatch behind its back.
    if (timer) { clearInterval(timer); timer = null; }
    return;
  }
  if (!state?.running) {
    if (timer) { clearInterval(timer); timer = null; }
    return;
  }

  state.heartbeatAt = Date.now();
  writeAutoState(state);

  try {
    // Never start a second run while one is alive.
    const live = loadDispatchStore().runs
      .filter((run) => run.cwd === state.cwd)
      .some((run) => !runLooksFinished(run));
    if (live) return;

    const plan = readPlan(state.cwd);
    if (plan.errors.length > 0) {
      stop(state, "error", `Plan has errors, so nothing was dispatched: ${plan.errors.join("; ")}`);
      return;
    }

    // What the last run actually achieved.
    const reported = readRunStates(state.cwd);
    const { dispatchedIds } = listDispatchState(state.cwd);
    const lastRun = loadDispatchStore().runs.filter((run) => run.cwd === state.cwd).at(-1);
    if (lastRun) {
      const bad = lastRun.ticketIds.filter((id) => {
        const reportedState = reported.get(id);
        return reportedState !== "done" && reportedState !== "skipped";
      });
      const skipped = lastRun.ticketIds.filter((id) => reported.get(id) === "skipped");
      const failed = lastRun.ticketIds.filter((id) => {
        const reportedState = reported.get(id);
        return reportedState !== "done" && reportedState !== "skipped";
      });
      // Anything that ran and came back done is no longer waiting.
      state.skipped = [...new Set([...(state.skipped ?? []), ...skipped])]
        .filter((id) => reported.get(id) !== "done");
      if (failed.length > 0) {
        const newly = failed.filter((id) => !state.abandoned.some((entry) => entry.id === id));
        for (const id of newly) {
          state.abandoned.push({ id, reason: reported.get(id) ?? "not reported in status.md" });
        }
        if (newly.length > 0) {
          note(state, `Left behind from ${lastRun.ticketIds[0]}–${lastRun.ticketIds.at(-1)}: ${newly.map((id) => `${id} (${reported.get(id) ?? "missing from status.md"})`).join(", ")}`);
        }
      }
      if (skipped.length > 0) note(state, `Skipped for now, will be offered again once their dependency lands: ${skipped.join(", ")}`);
    }

    // Rule 2: a ticket that needed something abandoned cannot run either.
    const abandoned = new Set(state.abandoned.map((entry) => entry.id.toUpperCase()));
    const unreachable = dependentsOf(plan, abandoned);
    // Dispatched-and-abandoned is not the same as done: a blocked ticket must
    // not release the work behind it.
    const waiting = new Set((state.skipped ?? []).map((id) => id.toUpperCase()));
    const satisfied = dispatchedIds.filter((id) => {
      const key = id.toUpperCase();
      return !abandoned.has(key) && !waiting.has(key);
    });
    const allowed = new Set((state.only ?? []).map((id) => id.toUpperCase()));
    const offLimits = allowed.size === 0
      ? []
      : plan.tickets.map((t) => t.id).filter((id) => !allowed.has(id.toUpperCase()));
    const next = suggestDispatchBatch(plan, satisfied, state.batchSize, {
      exclude: [...abandoned, ...unreachable, ...offLimits],
    });

    if (next.length === 0) {
      const waiting = unreachable.size;
      stop(state, abandoned.size > 0 ? "blocked" : "finished",
        abandoned.size > 0
          ? `Nothing left that does not depend on ${[...abandoned].join(", ")}. ${waiting} ticket(s) are waiting on them. Your call in the morning.`
          : allowed.size > 0
            ? "The tickets this run was allowed to dispatch are all done. The rest of the plan needs a person."
            : "Every ticket in the plan has been dispatched.");
      return;
    }
    if (state.batchesRun >= state.maxBatches) {
      stop(state, "limit", `Stopped after ${state.batchesRun} batches, as configured. Next would have been ${next[0]}–${next.at(-1)}.`);
      return;
    }

    const run = await startDispatch(state.cwd, next, "web");
    state.batchesRun += 1;
    note(state, `Batch ${state.batchesRun}: dispatched ${next[0]}–${next.at(-1)} (${next.length} tickets)${unreachable.size > 0 ? `, skipping ${unreachable.size} blocked by ${[...abandoned].join(", ")}` : ""}. Session ${run.sessionId}.`);
  } catch (error) {
    stop(state, "error", `Stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function startAutoDispatch(cwd: string, options: { maxBatches?: number; batchSize?: number; only?: readonly string[] } = {}): AutoState {
  const state: AutoState = {
    cwd,
    running: true,
    startedAt: Date.now(),
    batchesRun: 0,
    maxBatches: options.maxBatches ?? 12,
    batchSize: options.batchSize ?? DEFAULT_DISPATCH_BATCH,
    only: [...(options.only ?? [])],
    abandoned: [],
    skipped: [],
    log: [],
  };
  writeAutoState(state);
  note(state, `Auto-dispatch on for ${cwd}: up to ${state.maxBatches} batches of ${state.batchSize}.`);
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void tick(); }, CHECK_MS);
  timer.unref?.();
  void tick();
  return state;
}

export function stopAutoDispatch(): AutoState | null {
  const state = readAutoState();
  if (!state) return null;
  stop(state, "stopped", "Auto-dispatch turned off by hand.");
  return state;
}

/** Take the loop over: the previous owner is gone, or there never was one. */
export function claimAutoLoop(): AutoState | null {
  const state = readAutoState();
  if (!state?.running || hasLiveOwner(state)) return null;
  state.owner = { pid: process.pid, startedAt: Date.now() };
  writeAutoState(state);
  return state;
}

/** Re-arm the loop after a server restart, so a night's run survives one. */
export function resumeAutoDispatch(): void {
  const state = readAutoState();
  if (!state?.running || timer) return;
  if (hasLiveOwner(state)) return; // a standalone process is driving it
  timer = setInterval(() => { void tick(); }, CHECK_MS);
  timer.unref?.();
}
