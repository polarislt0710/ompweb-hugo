// Dispatch runs: start an omp foreman session for a reviewed plan, and keep the
// small amount of bookkeeping the web UI and the ChatGPT connector need to show
// what is running and what is waiting for approval.
//
// Stored in <agentDir>/ompweb-dispatch.json. Only ids, paths and timestamps are
// kept; the plan and results stay in the project's .omp/handoff files.

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { buildForemanPrompt } from "./dispatch-prompt";
import { allowFileRoot } from "./file-access";
import { readHandoffFiles } from "./handoff";
import { getAgentDir } from "./omp/paths";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import { invalidateSessionListCache } from "./session-reader";
import { parsePlan, type ParsedPlan } from "./work-plan";

export type DispatchSource = "web" | "chatgpt";
export type DispatchRequestStatus = "pending" | "approved" | "rejected";

export interface DispatchRun {
  id: string;
  cwd: string;
  sessionId: string;
  sessionFile: string;
  ticketIds: string[];
  source: DispatchSource;
  startedAt: number;
}

export interface DispatchRequest {
  id: string;
  /** "dispatch" starts a run; "message" sends `note` to an existing run's foreman. */
  kind?: "dispatch" | "message";
  cwd: string;
  ticketIds: string[];
  note: string;
  createdAt: number;
  status: DispatchRequestStatus;
  decidedAt?: number;
  /** For kind "message": the run to message. For "dispatch": the run started on approval. */
  runId?: string;
}

interface DispatchStore {
  version: 1;
  runs: DispatchRun[];
  requests: DispatchRequest[];
}

const MAX_RUNS = 50;
const MAX_REQUESTS = 50;
const MAX_NOTE_CHARS = 8000;

export class DispatchError extends Error {
  constructor(readonly code: "invalid_plan" | "unknown_ticket" | "not_found" | "already_decided", message: string) {
    super(message);
  }
}

function storePath(): string {
  return process.env.OMP_WEB_DISPATCH_STORE || join(getAgentDir(), "ompweb-dispatch.json");
}

export function loadDispatchStore(path = storePath()): DispatchStore {
  if (!existsSync(path)) return { version: 1, runs: [], requests: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DispatchStore>;
    return {
      version: 1,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
    };
  } catch {
    return { version: 1, runs: [], requests: [] };
  }
}

function saveDispatchStore(store: DispatchStore, path = storePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  store.runs = store.runs.slice(-MAX_RUNS);
  store.requests = store.requests.slice(-MAX_REQUESTS);
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

export function readProjectPlan(cwd: string): { markdown: string; plan: ParsedPlan } {
  const markdown = readHandoffFiles(cwd).find((file) => file.name === "plan.md")?.content ?? "";
  return { markdown, plan: parsePlan(markdown) };
}

/** Checks the plan and the ticket selection; returns the tickets that will run. */
export function validateDispatch(plan: ParsedPlan, ticketIds: readonly string[] | undefined): string[] {
  if (plan.errors.length > 0) {
    throw new DispatchError("invalid_plan", `Plan has errors: ${plan.errors.join("; ")}`);
  }
  const known = new Set(plan.tickets.map((ticket) => ticket.id));
  const selected = ticketIds && ticketIds.length > 0 ? ticketIds.map((id) => id.toUpperCase()) : [...known];
  const unknown = selected.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new DispatchError("unknown_ticket", `Unknown tickets: ${unknown.join(", ")}`);
  return selected;
}

export async function startDispatch(cwd: string, ticketIds: readonly string[] | undefined, source: DispatchSource): Promise<DispatchRun> {
  const { plan } = readProjectPlan(cwd);
  const selected = validateDispatch(plan, ticketIds);

  const { session, realSessionId } = await startRpcSession(`__dispatch__${randomUUID()}`, "", cwd);
  allowFileRoot(cwd);
  invalidateSessionListCache();
  try {
    await session.send({ type: "prompt", message: buildForemanPrompt(plan, selected) });
  } catch (error) {
    await session.destroyAndWait();
    throw error;
  }

  const run: DispatchRun = {
    id: randomUUID(),
    cwd,
    sessionId: session.sessionId || realSessionId,
    sessionFile: session.sessionFile,
    ticketIds: selected,
    source,
    startedAt: Date.now(),
  };
  const store = loadDispatchStore();
  store.runs.push(run);
  saveDispatchStore(store);
  return run;
}

export function createDispatchRequest(
  cwd: string,
  ticketIds: readonly string[] | undefined,
  note: string,
  options: { kind: "message"; runId: string } | { kind?: "dispatch" } = {},
): DispatchRequest {
  const isMessage = options.kind === "message";
  const selected = isMessage ? [] : validateDispatch(readProjectPlan(cwd).plan, ticketIds);
  const request: DispatchRequest = {
    id: randomUUID(),
    kind: isMessage ? "message" : "dispatch",
    ...(isMessage ? { runId: options.runId } : {}),
    cwd,
    ticketIds: selected,
    note: note.slice(0, MAX_NOTE_CHARS),
    createdAt: Date.now(),
    status: "pending",
  };
  const store = loadDispatchStore();
  store.requests.push(request);
  saveDispatchStore(store);
  return request;
}

export async function decideDispatchRequest(id: string, approve: boolean): Promise<{ request: DispatchRequest; run?: DispatchRun }> {
  const store = loadDispatchStore();
  const request = store.requests.find((entry) => entry.id === id);
  if (!request) throw new DispatchError("not_found", "Dispatch request not found");
  if (request.status !== "pending") throw new DispatchError("already_decided", `Request is already ${request.status}`);

  if (!approve) {
    request.status = "rejected";
    request.decidedAt = Date.now();
    saveDispatchStore(store);
    return { request };
  }
  if (request.kind === "message") {
    const target = request.runId ? store.runs.find((run) => run.id === request.runId) : undefined;
    if (!target) throw new DispatchError("not_found", "The run this message was for no longer exists");
    await messageDispatchRun(target, request.note);
    request.status = "approved";
    request.decidedAt = Date.now();
    saveDispatchStore(store);
    return { request, run: target };
  }
  const run = await startDispatch(request.cwd, request.ticketIds, "chatgpt");
  // startDispatch saved a new run; reload so that write is not lost.
  const fresh = loadDispatchStore();
  const target = fresh.requests.find((entry) => entry.id === id);
  if (target) {
    target.status = "approved";
    target.decidedAt = Date.now();
    target.runId = run.id;
    saveDispatchStore(fresh);
  }
  return { request: target ?? request, run };
}

export type DispatchRunState = "running" | "idle" | "ended";

export function dispatchRunState(run: DispatchRun): DispatchRunState {
  const session = getRpcSession(run.sessionId);
  if (!session?.isAlive()) return "ended";
  return session.isRunning() ? "running" : "idle";
}

export function listDispatchState(cwd?: string): {
  runs: Array<DispatchRun & { state: DispatchRunState }>;
  requests: DispatchRequest[];
} {
  const store = loadDispatchStore();
  const inProject = <T extends { cwd: string }>(entry: T) => !cwd || entry.cwd === cwd;
  return {
    runs: store.runs.filter(inProject).reverse().slice(0, 10).map((run) => ({ ...run, state: dispatchRunState(run) })),
    requests: store.requests.filter(inProject).reverse().slice(0, 10),
  };
}

/**
 * Send the foreman a message (e.g. "skip T3", or the answer to a
 * needs-decision question). A busy foreman is steered mid-run; an ended one is
 * resumed from its session file so it keeps the run's context.
 */
export async function messageDispatchRun(run: DispatchRun, text: string): Promise<"steered" | "prompted"> {
  const live = getRpcSession(run.sessionId);
  const session = live?.isAlive()
    ? live
    : (await startRpcSession(run.sessionId, run.sessionFile, run.cwd, undefined, undefined, run.cwd)).session;
  if (session.isRunning()) {
    await session.send({ type: "prompt", message: text, streamingBehavior: "steer" });
    return "steered";
  }
  await session.send({ type: "prompt", message: text });
  return "prompted";
}

export function findDispatchRun(id: string): DispatchRun | undefined {
  return loadDispatchStore().runs.find((run) => run.id === id);
}
