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

import { readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync, mkdirSync, copyFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getAgentDir } from "./omp/paths";
import { startDispatch, loadDispatchStore, type DispatchRun } from "./dispatch";
import { parsePlan, suggestDispatchBatch, splitIntoLanes, DEFAULT_DISPATCH_BATCH, type ParsedPlan } from "./work-plan";
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
  /**
   * How many foremen may run side by side. One foreman works through its batch
   * one ticket at a time, so a batch of four takes four tickets' worth of clock.
   * Lanes only ever hold work that cannot touch the same file.
   */
  maxLanes?: number;
  /** Every ticket the last batch handed out, across all of its lanes. */
  lastBatch?: string[];
  /** The most finished tickets status.md has ever reported. It must never fall. */
  doneHighWater?: number;
  /** How many times in a row the same batch has been selected. */
  repeats?: number;
  /**
   * Tickets to dispatch even though status.md already calls them done.
   *
   * A reviewer ticket records a verdict and finishes; when the thing it judged
   * changes, it has to judge again. Completion is otherwise the loop's guard
   * against re-running finished work, so this list is explicit and is cleared as
   * soon as the tickets go out.
   */
  force?: string[];
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
/**
 * Every ticket status.md has ever reported `done`, across all runs.
 *
 * This is the only honest answer to "what is finished". Asking "was it
 * dispatched" says yes for a ticket that was dispatched and skipped, and for one
 * whose session was killed — both of which then release the work behind them.
 */
export function readCompletedTickets(cwd: string): Set<string> {
  const path = join(cwd, HANDOFF_DIR, "status.md");
  const done = new Set<string>();
  if (!existsSync(path)) return done;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    // A foreman writes its verdict in the state cell, not only the word:
    // "done（round-5 verdict FAIL）" is a finished reviewer ticket. Requiring the
    // cell to hold nothing but "done" made the loop re-dispatch T127 and T160
    // eight times over ninety minutes, each round reaching the same conclusion.
    const row = /^\|\s*(T\d+)\s*\|\s*done\b/i.exec(line.trim());
    if (row) done.add(row[1].toUpperCase());
  }
  return done;
}

/**
 * The newest state status.md reports for each ticket, across every run section.
 *
 * `readRunStates` answers for one run, which is only useful when you know that
 * run is the newest section — and the loop did not: it compared the last
 * dispatched run against whatever section happened to be on top, and wrote off
 * T161/T163 as failures the tick after they both passed.
 */
export function readLatestStates(cwd: string): Map<string, TicketState> {
  const path = join(cwd, HANDOFF_DIR, "status.md");
  const states = new Map<string, TicketState>();
  if (!existsSync(path)) return states;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const row = /^\|\s*(T\d+)\s*\|\s*([A-Za-z-]+)\s*\|/.exec(line.trim());
    if (!row) continue;
    const id = row[1].toUpperCase();
    if (states.has(id)) continue; // sections run newest first
    const word = row[2].toLowerCase();
    states.set(id,
      word === "done" ? "done"
      : word === "blocked" ? "blocked"
      : word === "skipped" ? "skipped"
      : word.startsWith("needs") ? "needs-decision"
      : word === "running" ? "running"
      : "unknown");
  }
  return states;
}

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
 *
 * But the foreman's own file is not enough. A foreman that has handed its ticket
 * to a worker falls silent for as long as the worker runs, while the worker
 * appends to `<session dir>/<ticket>.jsonl` beside it. Reading only the foreman
 * is how T111 was dispatched three times in twelve minutes, each copy editing
 * the same page as the last. So take the newest write anywhere in the session:
 * the foreman's file, or any worker's.
 */
export function runLooksFinished(run: Pick<DispatchRun, "startedAt" | "sessionFile">, now = Date.now()): boolean {
  if (now - run.startedAt < START_GRACE_MS) return false;
  if (!run.sessionFile) return true;
  const lastWrite = newestWriteInSession(run.sessionFile);
  if (lastWrite === null) return true; // nothing was ever written; nothing to wait for
  return now - lastWrite > SILENCE_MS;
}

/** The newest mtime of a session's own file or of any worker file beside it. */
function newestWriteInSession(sessionFile: string): number | null {
  let newest: number | null = null;
  const note = (path: string) => {
    try {
      const { mtimeMs } = statSync(path);
      if (newest === null || mtimeMs > newest) newest = mtimeMs;
    } catch { /* not there: it contributes nothing */ }
  };
  note(sessionFile);
  // omp puts a session's subagent transcripts in a directory named after it.
  const dir = sessionFile.replace(/\.jsonl$/, "");
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".tombstone")) continue;
      note(join(dir, entry));
    }
  } catch { /* no subagents ran */ }
  return newest;
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


/**
 * Keep the last few copies of status.md.
 *
 * status.md is the only record of which tickets passed, and on 2026-09-19 three
 * foremen rewrote it at once and the last writer won: thirty-eight done tickets
 * became four, and the loop started re-running finished work. The file was
 * rebuilt from the tickets' receipts, which is slow and lossy. A copy taken
 * before every dispatch makes that a one-line restore instead.
 */
export function backUpStatus(cwd: string, keep = 20): string | null {
  const source = join(cwd, HANDOFF_DIR, "status.md");
  if (!existsSync(source)) return null;
  const dir = join(getAgentDir(), "ompweb-status-backups", cwd.replace(/[^\w.-]+/g, "-"));
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  copyFileSync(source, target);
  for (const stale of readdirSync(dir).sort().slice(0, -keep)) {
    try { unlinkSync(join(dir, stale)); } catch { /* another process got there first */ }
  }
  return target;
}

/**
 * Has status.md lost tickets it used to hold?
 *
 * A run can only ever add verdicts. If the file comes back knowing about fewer
 * finished tickets than it did last tick, something overwrote it, and carrying
 * on means re-dispatching work that has already passed.
 */
export function lostHistory(previousHighWater: number | undefined, doneNow: number): boolean {
  return previousHighWater !== undefined && doneNow < previousHighWater;
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
    const reported = readLatestStates(state.cwd);
    // The whole batch, not the last run: a batch may have gone out in several
    // lanes at once, and judging only the last lane writes off the others.
    const lastBatch = state.lastBatch ?? [];
    if (lastBatch.length > 0) {
      const skipped = lastBatch.filter((id) => reported.get(id) === "skipped");
      // Only an explicit verdict counts against a ticket. A ticket the table
      // never mentions is simply not done yet: it goes back in the queue, which
      // is how T111 was finally caught after a run claimed 12/12 with 11 rows.
      const failed = lastBatch.filter((id) => {
        const reportedState = reported.get(id);
        return reportedState === "blocked" || reportedState === "needs-decision";
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
          note(state, `Left behind from ${lastBatch[0]}–${lastBatch.at(-1)}: ${newly.map((id) => `${id} (${reported.get(id) ?? "missing from status.md"})`).join(", ")}`);
        }
      }
      if (skipped.length > 0) note(state, `Skipped for now, will be offered again once their dependency lands: ${skipped.join(", ")}`);
    }

    // Rule 2: a ticket that needed something abandoned cannot run either.
    const abandoned = new Set(state.abandoned.map((entry) => entry.id.toUpperCase()));
    const unreachable = dependentsOf(plan, abandoned);
    // Dispatched-and-abandoned is not the same as done: a blocked ticket must
    // not release the work behind it.
    // Finished means status.md said done — not merely that a run took it.
    const forced = new Set((state.force ?? []).map((id) => id.toUpperCase()));
    const satisfied = [...readCompletedTickets(state.cwd)]
      .filter((id) => !abandoned.has(id) && !forced.has(id));

    // status.md may only ever learn more. Fewer means it was overwritten.
    if (lostHistory(state.doneHighWater, satisfied.length)) {
      stop(state, "error",
        `status.md now reports ${satisfied.length} finished tickets, down from ${state.doneHighWater}. ` +
        `Something overwrote it; a copy from before the last dispatch is in ompweb-status-backups. ` +
        `Nothing was dispatched, so no finished work has been re-run.`);
      return;
    }
    state.doneHighWater = Math.max(state.doneHighWater ?? 0, satisfied.length);

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
    // A batch that comes back unchanged twice has nothing more to give: the
    // third attempt would reach the same conclusion and cost the same money.
    const sameAsLast = state.lastBatch && state.lastBatch.length === next.length
      && state.lastBatch.every((id, i) => id.toUpperCase() === next[i].toUpperCase());
    state.repeats = sameAsLast ? (state.repeats ?? 0) + 1 : 0;
    if (state.repeats >= 2) {
      stop(state, "blocked",
        `${next.join(", ")} came back unchanged ${state.repeats + 1} times. Re-running it would reach the same answer, so the loop stopped instead of paying for a fourth round.`);
      return;
    }

    if (state.batchesRun >= state.maxBatches) {
      stop(state, "limit", `Stopped after ${state.batchesRun} batches, as configured. Next would have been ${next[0]}–${next.at(-1)}.`);
      return;
    }

    // One lane until the shared status.md problem is solved; see splitIntoLanes.
    backUpStatus(state.cwd);
    // A forced ticket is owed exactly one run, not a standing exemption.
    if (state.force?.length) state.force = state.force.filter((id) => !next.some((n) => n.toUpperCase() === id.toUpperCase()));
    const lanes = splitIntoLanes(plan, next, state.maxLanes ?? 1);
    const runs = [];
    for (const lane of lanes) runs.push(await startDispatch(state.cwd, lane, "web"));
    state.batchesRun += 1;
    state.lastBatch = next;
    const shape = lanes.length > 1
      ? ` in ${lanes.length} lanes (${lanes.map((lane) => lane.join("+")).join(" | ")})`
      : "";
    note(state, `Batch ${state.batchesRun}: dispatched ${next[0]}–${next.at(-1)} (${next.length} tickets)${shape}${unreachable.size > 0 ? `, skipping ${unreachable.size} blocked by ${[...abandoned].join(", ")}` : ""}. Session ${runs.map((run) => run.sessionId).join(", ")}.`);
  } catch (error) {
    stop(state, "error", `Stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function startAutoDispatch(cwd: string, options: { maxBatches?: number; batchSize?: number; maxLanes?: number; only?: readonly string[] } = {}): AutoState {
  const state: AutoState = {
    cwd,
    running: true,
    startedAt: Date.now(),
    batchesRun: 0,
    maxBatches: options.maxBatches ?? 12,
    batchSize: options.batchSize ?? DEFAULT_DISPATCH_BATCH,
    maxLanes: options.maxLanes ?? 1,
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
