// Ticket plan format shared by the reviewer (GPT-6 Pro in ChatGPT, through the
// MCP connector or by paste) and the omp foreman that executes it.
//
// The plan lives in `.omp/handoff/plan.md`. It is plain markdown so a person
// can read and edit it, with one fixed shape per ticket so the web UI and the
// foreman can find tickets without asking a model to re-read the plan:
//
//   ### T1: Short title
//   - agent: worker
//   - depends: T0, T2        (or "none")
//   - files: lib/a.ts, lib/b.ts
//   - verify: npm test -- lib/a.test.mjs
//
//   Free-form steps and acceptance criteria.

export const PLAN_AGENTS = ["worker-fast", "worker", "frontend", "writer", "visual-checker", "scout", "researcher", "reviewer"] as const;
export type PlanAgent = (typeof PLAN_AGENTS)[number];

export const PLAN_FORMAT_GUIDE = `Plan format (.omp/handoff/plan.md):

# Plan: <one-line goal>

## Context
Short background every worker needs: stack, constraints, what not to touch.

## Tickets

### T1: <short title>
- agent: worker-fast | worker | frontend | writer | visual-checker | scout | researcher | reviewer
- depends: none | T<n>, T<m>
- files: path/one.ts, path/two.ts
- verify: <one shell command that passes once THIS ticket is done, e.g. npm test -- lib/x.test.mjs>

Steps and acceptance criteria in plain markdown. Be specific enough that the
worker does not need to re-investigate: name functions, expected behaviour and
edge cases.

Agent guide: worker-fast = fully specified mechanical edit; worker = one scoped
coding ticket (backend, queues, DB, services); frontend = one scoped front-end
ticket — React/Next components, TypeScript wiring, CSS and design tokens,
responsive and accessibility work — on a model that also reads screenshots and
mockups, so give it the capture or the design file when the ticket is visual;
writer = copy/docs; visual-checker = screenshots/UI check (read-only);
scout = read/search the codebase only; researcher = look something up on the web
and report it with its sources (Perplexity, no token cost);
reviewer = review a diff (read-only).
Anything under a frontend/ or components/ path belongs to frontend, not worker.
A ticket that depends on a fact nobody here knows — a syllabus rule, a current
API, a price — belongs to researcher, with its output file named, and the
tickets that need the answer depending on it. Do not make a coding worker guess.
Keep tickets small (one worker, under ~30 minutes). Ticket ids must be unique.
A verify command must be able to pass on its own. If a shared suite only goes
green after several tickets, give the earlier tickets a narrower check and put
the full suite on the last ticket (or on a final review ticket).`;

/**
 * How many tickets one foreman run should carry. A reviewed plan can run to a
 * hundred tickets; handing them all to one session buries it in context, blows
 * the task budget long before the end, and leaves nothing to inspect halfway.
 */
export const DEFAULT_DISPATCH_BATCH = 12;

/**
 * The next tickets to dispatch: plan order, but only ones whose prerequisites
 * are already satisfied — by an earlier run, or by a ticket earlier in this same
 * batch, which the foreman runs in dependency order.
 *
 * Plan order alone is not enough. A reviewer can add a gate late: the repair
 * chain T145-T160 was appended after T113-T123, then T113-T123 were made to
 * depend on it, so the file's order and the dependency order disagree. Picking
 * by position would have dispatched work whose gate had not run.
 *
 * `satisfied` is what counts as done. A ticket that was dispatched but came back
 * blocked does not belong in it, or everything behind it would be released.
 */
export function suggestDispatchBatch(
  plan: ParsedPlan,
  satisfied: Iterable<string> = [],
  limit = DEFAULT_DISPATCH_BATCH,
  options: { exclude?: Iterable<string> } = {},
): string[] {
  const done = new Set([...satisfied].map((id) => id.toUpperCase()));
  const skip = new Set([...(options.exclude ?? [])].map((id) => id.toUpperCase()));
  const chosen: string[] = [];
  const ready = new Set(done);
  for (const ticket of plan.tickets) {
    if (chosen.length >= Math.max(1, limit)) break;
    const id = ticket.id.toUpperCase();
    if (done.has(id) || skip.has(id)) continue;
    if (!ticket.depends.every((dep) => ready.has(dep.toUpperCase()))) continue;
    chosen.push(ticket.id);
    ready.add(id);
  }
  return chosen;
}

export interface PlanTicket {
  id: string;
  title: string;
  agent: string;
  depends: string[];
  files: string[];
  verify: string | null;
  /** The ticket's full markdown, heading included, passed verbatim to the worker. */
  body: string;
}

export interface ParsedPlan {
  title: string | null;
  context: string;
  tickets: PlanTicket[];
  errors: string[];
  warnings: string[];
}

const TICKET_HEADING = /^###\s+(T\d+)\s*[:：-]\s*(.+?)\s*$/;
const FIELD = /^\s*[-*]\s*(agent|depends|files|verify)\s*[:：]\s*(.*?)\s*$/i;

function splitList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || /^(none|n\/a|-|無|没有|沒有)$/i.test(trimmed)) return [];
  return trimmed.split(/[,，、]/).map((part) => part.trim().replace(/^`|`$/g, "")).filter(Boolean);
}

function stripCode(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 1 ? trimmed.slice(1, -1).trim() : trimmed;
}

export function parsePlan(markdown: string): ParsedPlan {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const errors: string[] = [];
  const warnings: string[] = [];
  let title: string | null = null;
  const contextLines: string[] = [];
  const tickets: PlanTicket[] = [];

  let section: "none" | "context" | "tickets" | "other" = "none";
  let current: { id: string; title: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const ticket: PlanTicket = { id: current.id, title: current.title, agent: "", depends: [], files: [], verify: null, body: current.lines.join("\n").trim() };
    for (const line of current.lines.slice(1)) {
      const match = FIELD.exec(line);
      if (!match) continue;
      const key = match[1].toLowerCase();
      if (key === "agent") ticket.agent = stripCode(match[2]).toLowerCase();
      else if (key === "depends") ticket.depends = splitList(match[2]).map((id) => id.toUpperCase());
      else if (key === "files") ticket.files = splitList(match[2]);
      else if (key === "verify") ticket.verify = stripCode(match[2]) || null;
    }
    tickets.push(ticket);
    current = null;
  };

  for (const line of lines) {
    const ticketMatch = TICKET_HEADING.exec(line);
    if (ticketMatch) {
      flush();
      current = { id: ticketMatch[1].toUpperCase(), title: ticketMatch[2], lines: [line] };
      continue;
    }
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      flush();
      if (title === null) title = line.replace(/^#\s+/, "").replace(/^plan\s*[:：]\s*/i, "").trim() || null;
      continue;
    }
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      flush();
      const heading = line.replace(/^##\s+/, "").trim().toLowerCase();
      section = heading.startsWith("context") || heading === "背景" ? "context" : heading.startsWith("ticket") ? "tickets" : "other";
      continue;
    }
    if (current) current.lines.push(line);
    else if (section === "context") contextLines.push(line);
  }
  flush();

  if (tickets.length === 0) errors.push("No tickets found. Each ticket needs a heading like `### T1: title`.");

  const ids = new Set<string>();
  for (const ticket of tickets) {
    if (ids.has(ticket.id)) errors.push(`${ticket.id}: duplicate ticket id`);
    ids.add(ticket.id);
  }
  for (const ticket of tickets) {
    if (!ticket.agent) warnings.push(`${ticket.id}: no agent, the foreman will use worker`);
    else if (!(PLAN_AGENTS as readonly string[]).includes(ticket.agent)) warnings.push(`${ticket.id}: unknown agent "${ticket.agent}", the foreman will use worker`);
    if (!ticket.verify) warnings.push(`${ticket.id}: no verify command`);
    for (const dep of ticket.depends) {
      if (dep === ticket.id) errors.push(`${ticket.id}: depends on itself`);
      else if (!ids.has(dep)) errors.push(`${ticket.id}: depends on unknown ticket ${dep}`);
    }
  }

  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): boolean => {
    if (state.get(id) === "done") return false;
    if (state.get(id) === "visiting") {
      errors.push(`Dependency cycle: ${[...path, id].join(" → ")}`);
      return true;
    }
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.depends ?? []) {
      if (byId.has(dep) && visit(dep, [...path, id])) return true;
    }
    state.set(id, "done");
    return false;
  };
  for (const ticket of tickets) if (visit(ticket.id, [])) break;

  return { title, context: contextLines.join("\n").trim(), tickets, errors, warnings };
}

/**
 * Split a batch into lanes that can run at the same time.
 *
 * One foreman takes its tickets one after another, so a batch of four is four
 * tickets' worth of wall clock, not one. Several foremen at once fixes that, but
 * only if no two of them can write the same file: three copies of T111 ran
 * concurrently on 2026-09-19 and all three edited the same page, which is the
 * failure this guards against.
 *
 * NOT SAFE YET for this project: a ticket's `files` list covers what the worker
 * edits, but every foreman also rewrites `.omp/handoff/status.md`, which no
 * ticket declares. Three lanes did exactly that on 2026-09-19 at 16:05 and the
 * last writer won, erasing every earlier run from the file; the tickets' own
 * receipts survived and were used to rebuild it. Lanes stay capped at one until
 * each foreman writes its own status file and something merges them.
 *
 * Tickets that share a path land in the same lane, where they run in order.
 * Lanes are the connected components of "shares a file with", so two lanes can
 * never touch the same path. Components are merged until there are at most
 * `maxLanes` of them; merging only ever makes a lane more sequential, never less
 * safe.
 */
export function splitIntoLanes(plan: ParsedPlan, ticketIds: readonly string[], maxLanes = 3): string[][] {
  const wanted = ticketIds.map((id) => id.toUpperCase());
  const tickets = plan.tickets.filter((t) => wanted.includes(t.id.toUpperCase()));
  if (tickets.length === 0) return [];

  // Union-find over "these two tickets could write the same path".
  const parent = new Map<string, string>(tickets.map((t) => [t.id, t.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      if (pathsCollide(tickets[i].files, tickets[j].files)) union(tickets[i].id, tickets[j].id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const ticket of tickets) {
    const root = find(ticket.id);
    groups.set(root, [...(groups.get(root) ?? []), ticket.id]);
  }
  // Keep plan order inside a lane: a later ticket may expect an earlier one's work.
  const lanes = [...groups.values()];
  // Merging over the cap: always fold the smallest lane into the next smallest,
  // so the batch finishes as early as its longest lane and no sooner.
  while (lanes.length > Math.max(1, maxLanes)) {
    lanes.sort((a, b) => a.length - b.length);
    const smallest = lanes.shift()!;
    lanes[0].push(...smallest);
  }
  lanes.sort((a, b) => b.length - a.length);
  for (const lane of lanes) lane.sort((a, b) => wanted.indexOf(a.toUpperCase()) - wanted.indexOf(b.toUpperCase()));
  return lanes;
}

/** Could these two file lists reach the same path? A listed directory owns everything under it. */
function pathsCollide(a: readonly string[], b: readonly string[]): boolean {
  const norm = (p: string) => p.replace(/^\.\//, "").replace(/\/+$/, "");
  for (const left of a.map(norm)) {
    for (const right of b.map(norm)) {
      if (left === right) return true;
      if (left.startsWith(right + "/") || right.startsWith(left + "/")) return true;
    }
  }
  return false;
}
