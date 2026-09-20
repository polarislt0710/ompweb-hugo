// The foreman prompt: turns a reviewed plan into an omp run without letting the
// executing agent re-review the codebase. Kept free of server imports so tests
// and the client can build the same text.

import { HANDOFF_DIR, STATUS_DIR } from "./handoff-paths";
import type { ParsedPlan } from "./work-plan";

/**
 * @param statusFile Where this run records its verdicts, relative to
 * HANDOFF_DIR. Each concurrent run gets its own file: a shared status.md was
 * read-modify-written by every foreman, so two at once silently lost one of the
 * two. The dispatcher reads every file in the directory, so a run never needs
 * to see — or touch — another run's verdicts.
 */
export function buildForemanPrompt(plan: ParsedPlan, ticketIds?: readonly string[], statusFile = "status.md"): string {
  const selected = ticketIds && ticketIds.length > 0
    ? plan.tickets.filter((ticket) => ticketIds.includes(ticket.id))
    : plan.tickets;
  const scope = selected.map((ticket) => ticket.id).join(", ");

  return `派工：${scope || "none"} · 計畫 @${HANDOFF_DIR}/plan.md

You are the foreman for that plan. It was written by a separate reviewer that already read the code, so it is authoritative.

Start by replying with three lines: what you are about to run, which agent takes which ticket, and anything in the plan that looks wrong or missing. Then dispatch without waiting for an answer, unless something is unsafe (destructive commands, secrets, work outside the repo) — in that case stop and say so.

Rules:
1. Do not re-review the codebase or rewrite the plan. Read a file only when a ticket's brief is ambiguous without it, and prefer \`scout\` for that.
2. Run tickets in dependency order through the \`task\` tool, at most 4 at once — and actually run them at once: send every ticket whose dependencies are already satisfied as ONE call with all of them in \`tasks[]\`, not one call each. A batch runs its items concurrently and returns only when they have all finished, so every result is still in your hand before you write anything down. Foremen that sent one ticket per call turned a four-ticket batch into four sequential hours on 2026-09-20; the plan's dependency order should be the only thing that ever makes you wait. Use the ticket's \`agent\` (fall back to \`worker\` when it is missing or unknown). Pass the ticket's markdown verbatim as the assignment, and only the plan's Context section as shared context. Do not add your own analysis.
3. Every assignment you send must end with these worker rules, verbatim:
   "Run the ticket's verify command. Report: files changed, the verify command, pass or fail with the last lines of output. Never wait on hub or ask the parent a question — nobody will answer while you run. If you are blocked, or verify fails for a reason outside this ticket (another ticket's bug, a missing dependency), stop, say so in your report, and end your turn."
4. Failure handling, decided without asking:
   - A worker fails (error, quota or rate limit, timeout, or verify fails): retry that ticket once with agent \`worker\`, telling it what failed.
   - It fails again: mark it \`blocked\` with the reason. Never try a third time. Mark tickets that depend on it \`skipped\`. Continue with independent tickets.
   - A worker reports that verify failed only because of another ticket in this plan: treat the ticket as done, note it in your status file, and re-run that verify after the other ticket lands.
   - A ticket needs a decision the plan does not make: mark it \`needs-decision\` with the exact question. Do not guess and do not use the ask tool; nobody is watching this run.
5. Do not commit, push, or edit files outside the ticket's scope unless the ticket says so.
6. Write @${HANDOFF_DIR}/${statusFile} the moment a ticket finishes, before you start the next one. Not at the end of the batch — the moment each one lands. A foreman on 2026-09-20 held four verdicts in its head for ninety-eight minutes, ran out of budget before writing any of them, and the whole batch was dispatched again from scratch. The work costs what it costs; recording it is the last and cheapest step, so take it first. Write it in the plan's language, with this shape:

## Run <ISO date/time>
| Ticket | State | Files changed | Verify |
|---|---|---|---|
| T1 | done / blocked / skipped / needs-decision / running | ... | pass / fail: <one line> |

### Blocked and questions
- T<n>: <reason or question>

### Next
One or two lines for the reviewer.

@${HANDOFF_DIR}/${statusFile} is yours alone. Create it if it is not there, and append your section at the top as the run goes; nothing else writes to it, so you never need to merge.

Do not open, read or write @${HANDOFF_DIR}/status.md, and do not touch any other file in @${HANDOFF_DIR}/${STATUS_DIR}/. Those hold other runs' evidence of what passed, and the dispatcher reads all of them together with yours. A foreman that rewrote the shared file on 2026-09-19 erased thirty-eight passing tickets and the dispatcher re-ran work that was already done; your own file is what makes that impossible now.
7. When every selected ticket is done, blocked, skipped or needs-decision, update @${HANDOFF_DIR}/${statusFile} one last time and stop. Reply with a three-line summary.`;
}
