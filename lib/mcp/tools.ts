// Tools exposed to ChatGPT. The split follows the agreed roles:
// ChatGPT (GPT-6 Pro) reads, reviews, writes the plan and checks results;
// omp executes. Nothing here runs arbitrary commands or edits source files.
// Starting or steering a run needs approval in OMP Web unless the owner set
// OMP_WEB_MCP_DIRECT_DISPATCH=1.

import { existsSync, readFileSync, writeFileSync, realpathSync } from "fs";
import { join, sep } from "path";
import {
  createDispatchRequest,
  DispatchError,
  findDispatchRun,
  listDispatchState,
  messageDispatchRun,
  readProjectPlan,
  startDispatch,
} from "../dispatch";
import { HandoffError, readHandoffFiles, writeHandoffFile, HANDOFF_DIR } from "../handoff";
import { getSessionUsageBreakdown } from "../session-usage";
import { parsePlan, PLAN_FORMAT_GUIDE } from "../work-plan";
import { readLatestStates } from "../dispatch-auto";
import { capturePages, readProjectImage, MAX_TARGETS, type CapturedImage } from "./screenshots";
import { searchWeb, WebSearchError } from "./web-search";
import {
  applySandboxPatch,
  discardSandbox,
  openSandbox,
  runInSandbox,
  sandboxExists,
  sandboxPath,
  SandboxError,
  SANDBOX_TIMEOUT_MS,
} from "./sandbox";
import {
  isSecretPath,
  listConnectorProjects,
  listVisibleFiles,
  ProjectAccessError,
  readProjectFile,
  resolveConnectorProject,
  runGit,
  type ConnectorProject,
} from "./project-files";

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint?: boolean; idempotentHint?: boolean };
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const MAX_LIST_FILES = 800;
const MAX_SEARCH_MATCHES = 300;
const MAX_DIFF_BYTES = 400 * 1024;
// A reviewed plan for a whole product track runs to a hundred-odd tickets: the
// EdSight one is 112 KB at 63 tickets and still being written. The foremen that
// read it have million-token windows, so the cap is a guard against nonsense,
// not a budget.
const MAX_PLAN_BYTES = 500 * 1024;
const MAX_MESSAGE_CHARS = 8000;

const projectProp = { type: "string", description: "Project name or absolute path from list_projects." };
const readOnly = { readOnlyHint: true, openWorldHint: false, destructiveHint: false } as const;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "list_projects",
    title: "List projects",
    description: "List the coding projects on the OMP Web machine that you can review.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "project_overview",
    title: "Project overview",
    description: "Branch, uncommitted changes, recent commits, top-level layout, and the current plan/status summary for a project. Start here.",
    inputSchema: { type: "object", properties: { project: projectProp }, required: ["project"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "list_files",
    title: "List files",
    description: "List files git would show (ignored files and secrets are hidden). Filter by directory prefix and/or a substring.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        dir: { type: "string", description: "Directory prefix, e.g. lib/ or components/chat" },
        contains: { type: "string", description: "Case-insensitive substring the path must contain" },
      },
      required: ["project"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "read_file",
    title: "Read file",
    description: `Read a project file with line numbers. Up to ${2000} lines per call; use start_line/end_line for large files.`,
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        path: { type: "string", description: "Path relative to the project root" },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
      required: ["project", "path"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "search_code",
    title: "Search code",
    description: "Search project files (git grep). Returns path:line:text matches.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        query: { type: "string", description: "Text to find (fixed string unless regex is true)" },
        regex: { type: "boolean", description: "Treat query as an extended regular expression" },
        case_sensitive: { type: "boolean" },
        dir: { type: "string", description: "Limit to this directory" },
      },
      required: ["project", "query"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "git_diff",
    title: "Git diff",
    description: "Uncommitted changes (or changes since a base commit/branch), with a stat summary and new untracked files. Use it to check a run's work.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        base: { type: "string", description: "Commit or branch to diff against, e.g. HEAD~3 or main. Default: uncommitted changes vs HEAD." },
        path: { type: "string", description: "Limit to a file or directory" },
      },
      required: ["project"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "get_handoff",
    title: "Read plan and status",
    description: "Read .omp/handoff plan.md (with parsed tickets and validation), status.md written by the executing agents, and decisions.md.",
    inputSchema: { type: "object", properties: { project: projectProp }, required: ["project"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "get_runs",
    title: "Runs and usage",
    description: "Recent dispatch runs for a project: running/idle/ended, tickets, cost and context size of the foreman and its workers, model fallbacks, and pending approval requests.",
    inputSchema: { type: "object", properties: { project: projectProp }, required: ["project"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "git_status",
    title: "Git status",
    description: "Which branch this project is on, what is staged, modified or untracked, and how far ahead or behind the upstream. Use it to tell whether a ticket's work has actually landed in the tree yet.",
    inputSchema: {
      type: "object",
      properties: { project: projectProp },
      required: ["project"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "git_log",
    title: "Git log",
    description: "Recent commits: hash, author, date and subject. Use it to see what has been committed since a ticket ran.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        limit: { type: "integer", description: "How many commits (default 20, max 100)" },
        path: { type: "string", description: "Only commits touching this file or directory" },
      },
      required: ["project"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "read_artifact",
    title: "Read a run artifact",
    description: "Read a file under artifacts/ — a receipt, a test log, a capture manifest. This is where workers put the evidence for what they did, so read it before believing a ticket passed.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        path: { type: "string", description: "Path under artifacts/, e.g. artifacts/edsight-r05/receipts/T159.json" },
      },
      required: ["project", "path"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "list_tickets",
    title: "List tickets",
    description: "Every ticket in a plan with its agent, dependencies and the verdict status.md last recorded for it. Use it to see what is done, what is waiting and what is blocked without reading the whole plan.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        plan_file: { type: "string", description: "Plan file under .omp/handoff/ (default plan.md)" },
        state: { type: "string", description: "Only tickets with this verdict: done, blocked, needs-decision, skipped, running, or pending for ones status.md has not mentioned" },
      },
      required: ["project"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "sandbox_open",
    title: "Open a sandbox",
    description: "Create a private git worktree off this project's HEAD that you may write in and run commands in. Your changes stay there: the project's own working tree is untouched, and nothing merges without the owner. One sandbox at a time — discard the old one first.",
    inputSchema: { type: "object", properties: { project: projectProp }, required: ["project"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "sandbox_diff",
    title: "Sandbox diff",
    description: "What you have changed in the sandbox, against the commit it was opened from. Show this to the owner; it is what they will judge.",
    inputSchema: { type: "object", properties: { project: projectProp }, required: ["project"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "sandbox_discard",
    title: "Discard the sandbox",
    description: "Delete the sandbox worktree and its branch. Anything not already shown to the owner is lost.",
    inputSchema: { type: "object", properties: { project: projectProp }, required: ["project"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "apply_patch",
    title: "Apply a patch in the sandbox",
    description: "Apply a unified diff inside the sandbox. Paths that leave the sandbox, or that look like credentials, are refused. Open a sandbox first.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        patch: { type: "string", description: "A unified diff, as `git diff` prints it" },
      },
      required: ["project", "patch"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "run_command",
    title: "Run a command in the sandbox",
    description: "Run one command inside the sandbox — tests, a linter, a build. It starts in the sandbox root, with its own HOME and an environment built from an allow-list, so no credential this server holds is visible to it. Commands that reach a remote are refused. Five minute ceiling.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        command: { type: "string", description: "Command name, e.g. pytest" },
        args: { type: "array", items: { type: "string" }, description: "Arguments" },
      },
      required: ["project", "command"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "view_image",
    title: "View an image",
    description: "Look at an image already in the project: a design mockup, an exported screen, a saved screenshot. PNG, JPG, GIF, WebP or AVIF, up to 4 MB.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        path: { type: "string", description: "Path to the image, relative to the project root" },
      },
      required: ["project", "path"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "capture_page",
    title: "Capture pages",
    description: `Screenshot up to ${MAX_TARGETS} pages with headless Chrome and look at them. Each target is an HTML file in the project (a mockup), a page on a dev server the owner is already running here (http://localhost:PORT/path), or a deployed site (https://example.com/pricing). Full-page by default, and \`viewport: "both"\` returns a desktop and a phone shot of each page — made for comparing the built UI against the design, one screen at a time. It does not start a dev server. A page behind a login comes back logged out unless the owner saved a signed-in session for that host in OMP Web, in which case the shot says \"signed in\".`,
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        targets: {
          type: "array",
          items: { type: "string" },
          description: `1-${MAX_TARGETS} pages, e.g. ["mockups/index.html", "https://example.com/dashboard"]`,
        },
        viewport: { type: "string", enum: ["desktop", "phone", "both"], description: "Default desktop (1280px). phone is 390px." },
        width: { type: "integer", description: "Custom viewport width, 320-2000 (overrides viewport)" },
        height: { type: "integer", description: "Custom viewport height, 320-2000" },
        full_page: { type: "boolean", description: "Whole scrollable page (default true) or just the first screen" },
        wait_ms: { type: "integer", description: "Extra time to let the page settle, up to 30000 (default 1200). A dashboard that fetches its data after load needs several seconds, or the shot is of a skeleton." },
      },
      required: ["project", "targets"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "search_web",
    title: "Search the web",
    description: "Search the web through the owner's own Perplexity subscription and get an answer with its sources named. Costs no tokens. Default focus is HKDSE: the question is pinned to Hong Kong's exam authority and curriculum sources (hkeaa.edu.hk, edb.gov.hk) instead of whatever syllabus ranks highest worldwide. Use focus \"web\" for ordinary questions — a library's docs, a framework's release notes.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to find out, in one question (up to 400 characters)" },
        focus: { type: "string", enum: ["hkdse", "web"], description: "hkdse (default) pins the answer to Hong Kong exam sources; web searches without that constraint" },
        recency: { type: "string", enum: ["hour", "day", "week", "month", "year"], description: "Only consider pages from this window" },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "How many sources to draw on (default 5)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
  },
  {
    name: "write_plan",
    title: "Write plan",
    description: `Save the reviewed plan to .omp/handoff/plan.md so OMP workers can execute it. The plan is validated first; nothing is written if it has errors. Optionally also replace decisions.md.\n\n${PLAN_FORMAT_GUIDE}`,
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        plan_markdown: { type: "string", description: "The whole plan in the required format" },
        decisions_markdown: { type: "string", description: "Optional: key decisions and why, replaces decisions.md" },
        plan_file: { type: "string", description: "Which file under .omp/handoff/ to write, e.g. plan-math-physics.md. Required, and plan.md is refused. Use this when another line of work already owns plan.md — a ticket there is pinned by its own hash, and rewriting the file invalidates the evidence of every run in flight." },
      },
      required: ["project", "plan_markdown", "plan_file"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "request_dispatch",
    title: "Dispatch tickets",
    description: "Ask OMP to execute tickets from the saved plan (all tickets when ticket_ids is omitted). A foreman agent assigns them to workers, handles failures, and writes status.md. The owner approves the request in OMP Web unless direct dispatch is enabled.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        ticket_ids: { type: "array", items: { type: "string" }, description: "e.g. [\"T1\", \"T2\"]" },
        plan_file: { type: "string", description: "Dispatch from .omp/handoff/<name>.md — the plan you wrote with write_plan. Omit only to dispatch the owner's plan.md." },
        note: { type: "string", description: "One or two lines for the owner, shown with the approval request" },
      },
      required: ["project"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "message_foreman",
    title: "Message the foreman",
    description: "Send an instruction to the foreman of a run, e.g. answer a needs-decision question or say \"skip T3\". A running foreman is steered immediately; an ended run is resumed. Needs owner approval in OMP Web unless direct dispatch is enabled.",
    inputSchema: {
      type: "object",
      properties: {
        project: projectProp,
        run_id: { type: "string", description: "Run id from get_runs. Default: the latest run." },
        message: { type: "string" },
      },
      required: ["project", "message"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

export const MCP_SERVER_INSTRUCTIONS = `OMP Web connector. Roles: you (the reviewer) read code, write a ticket plan and check results; OMP's foreman and workers execute it.
Workflow: list_projects → project_overview → list_files / search_code / read_file → write_plan → request_dispatch → later get_runs + get_handoff (status.md) + git_diff to review → write a follow-up plan if needed.
For UI work you can also look: view_image opens a mockup or a saved screenshot, and capture_page screenshots several pages at once — project HTML files, a local dev server, or the deployed site — full-page, at desktop and phone widths, so you can compare the built screen against the design one screen at a time.
search_web answers from the web with its sources named, through the owner's own subscription, and defaults to Hong Kong HKDSE sources — use it before asserting anything about the exam, the curriculum or a library's current behaviour. When the work itself needs a lookup, do not do it here: give the plan a ticket with agent: researcher, which has the same search and writes its findings to a file the other tickets depend on.
Front-end tickets go to agent: frontend, which reads images as well as code — point it at the capture or mockup when the ticket is visual.
Make tickets specific enough that workers need no investigation. Workers are cheap models; the plan is where the thinking goes.`;

function directDispatch(): boolean {
  return process.env.OMP_WEB_MCP_DIRECT_DISPATCH === "1";
}

function ok(text: string, structured?: Record<string, unknown>): McpToolResult {
  return { content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) };
}

/** Images, each with a line saying what it is, so a client that drops images still shows something. */
function images(shots: readonly CapturedImage[], caption: string, notes: readonly string[] = []): McpToolResult {
  const content: McpContent[] = [];
  for (const shot of shots) {
    content.push({ type: "text", text: `${caption} — ${shot.source}, ${(shot.bytes / 1024).toFixed(0)} KB` });
    content.push({ type: "image", data: shot.data, mimeType: shot.mimeType });
  }
  if (notes.length > 0) content.push({ type: "text", text: `Not captured:\n- ${notes.join("\n- ")}` });
  return { content };
}

function fail(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeRelDir(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized === ".") return undefined;
  if (normalized.startsWith("/") || normalized.split("/").includes("..") || normalized.startsWith("-")) {
    throw new ProjectAccessError("invalid_argument", "dir/path must be a relative path inside the project");
  }
  return normalized;
}

async function projectOverview(project: ConnectorProject) {
  const parts: string[] = [`# ${project.name}`, `Path: ${project.path}`];
  if (project.git) {
    const [branch, status, log, files] = await Promise.all([
      runGit(project, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "?"),
      runGit(project, ["status", "--short", "--untracked-files=normal"]).catch(() => ""),
      runGit(project, ["log", "--oneline", "-n", "12"]).catch(() => ""),
      listVisibleFiles(project).catch(() => [] as string[]),
    ]);
    parts.push(`Branch: ${branch.trim()}`);
    const statusLines = status.split("\n").filter(Boolean);
    parts.push(`\n## Uncommitted changes (${statusLines.length})\n${statusLines.slice(0, 60).join("\n") || "none"}${statusLines.length > 60 ? "\n…" : ""}`);
    parts.push(`\n## Recent commits\n${log.trim() || "none"}`);
    const counts = new Map<string, number>();
    for (const file of files) {
      const top = file.includes("/") ? `${file.split("/")[0]}/` : file;
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    const layout = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => name.endsWith("/") ? `${name} (${count} files)` : name);
    parts.push(`\n## Layout (${files.length} files)\n${layout.join("\n")}`);
  } else {
    parts.push("Not a git repository: only the handoff notes are shared. Ask the owner to run `git init` to review code here.");
  }
  for (const doc of ["AGENTS.md", "CLAUDE.md"]) {
    if (existsSync(join(project.path, doc))) parts.push(`\nProject instructions: ${doc} (read it before planning).`);
  }
  const { plan } = readProjectPlan(project.path);
  const status = readHandoffFiles(project.path).find((file) => file.name === "status.md");
  parts.push(`\n## Handoff\nPlan: ${plan.tickets.length > 0 ? `${plan.title ?? "untitled"} — ${plan.tickets.length} tickets` : "none"}\nStatus: ${status?.exists ? `updated ${new Date(status.modifiedAt ?? 0).toISOString()}` : "none"}`);
  return parts.join("\n");
}

async function gitDiff(project: ConnectorProject, base: string | undefined, path: string | undefined) {
  if (base && (!/^[\w./~^@{}-]+$/.test(base) || base.startsWith("-"))) {
    throw new ProjectAccessError("invalid_argument", "base must be a commit, branch or ref expression");
  }
  const pathArgs = path ? ["--", path] : [];
  const common = ["--no-ext-diff", "--no-textconv", "--no-color"];
  // A repo without commits has no HEAD; diff against the empty tree instead.
  const head = base ?? await runGit(project, ["rev-parse", "--verify", "--quiet", "HEAD"]).then(() => "HEAD", () => "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  const target = [head];
  const [stat, patch, untracked] = await Promise.all([
    runGit(project, ["diff", ...common, "--stat", ...target, ...pathArgs]),
    runGit(project, ["diff", ...common, ...target, ...pathArgs]),
    runGit(project, ["ls-files", "--others", "--exclude-standard", ...(path ? ["--", path] : [])]),
  ]);
  const secretFree = patch.split(/(?=^diff --git )/m).filter((chunk) => {
    const match = /^diff --git a\/(.+?) b\//.exec(chunk);
    return !match || !isSecretPath(match[1]);
  }).join("");
  const truncated = Buffer.byteLength(secretFree) > MAX_DIFF_BYTES;
  const body = truncated ? `${secretFree.slice(0, MAX_DIFF_BYTES)}\n… diff truncated; pass path to narrow it.` : secretFree;
  const newFiles = untracked.split("\n").filter(Boolean).filter((file) => !isSecretPath(file));
  return `## Stat (vs ${target[0]})\n${stat.trim() || "no changes"}\n\n## Untracked files\n${newFiles.join("\n") || "none"}\n\n## Diff\n${body.trim() || "empty"}`;
}

async function handleTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  if (name === "list_projects") {
    const projects = await listConnectorProjects();
    return ok(projects.map((project) => `- ${project.name}: ${project.path}${project.git ? "" : " (no git)"}`).join("\n") || "No projects.", { projects });
  }

  if (name === "search_web") {
    const found = await searchWeb(args.query, { focus: args.focus, recency: args.recency, limit: args.limit });
    return ok(found.text, { provider: found.provider, query: found.query });
  }

  const project = await resolveConnectorProject(args.project);

  switch (name) {
    case "project_overview":
      return ok(await projectOverview(project));

    case "list_files": {
      const dir = safeRelDir(str(args, "dir"));
      const contains = str(args, "contains")?.toLowerCase();
      const files = (await listVisibleFiles(project))
        .filter((file) => !dir || file === dir || file.startsWith(`${dir}/`))
        .filter((file) => !contains || file.toLowerCase().includes(contains))
        .sort();
      const shown = files.slice(0, MAX_LIST_FILES);
      return ok(`${files.length} files${files.length > shown.length ? ` (showing ${shown.length}; narrow with dir or contains)` : ""}\n${shown.join("\n")}`);
    }

    case "read_file": {
      const start = typeof args.start_line === "number" ? args.start_line : undefined;
      const end = typeof args.end_line === "number" ? args.end_line : undefined;
      const file = await readProjectFile(project, args.path, start, end);
      const header = `${file.path} — lines ${file.startLine}-${file.endLine} of ${file.totalLines}${file.truncated ? " (more: call again with start_line)" : ""}`;
      return ok(`${header}\n${file.text}`);
    }

    case "search_code": {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query || query.length > 500) return fail("query must be 1-500 characters");
      const dir = safeRelDir(str(args, "dir"));
      const flags = ["grep", "-n", "-I", "--untracked", "--exclude-standard", "--no-color", "-e", query];
      if (args.regex !== true) flags.splice(5, 0, "-F");
      else flags.splice(5, 0, "-E");
      if (args.case_sensitive !== true) flags.splice(1, 0, "-i");
      let stdout = "";
      try {
        stdout = await runGit(project, [...flags, "--", ...(dir ? [dir] : ["."])]);
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code === 1) return ok("No matches.");
        throw error;
      }
      const lines = stdout.split("\n").filter(Boolean).filter((line) => !isSecretPath(line.split(":")[0] ?? ""));
      if (lines.length === 0) return ok("No matches.");
      const shown = lines.slice(0, MAX_SEARCH_MATCHES).map((line) => line.length > 400 ? `${line.slice(0, 400)}…` : line);
      return ok(`${lines.length} matches${lines.length > shown.length ? ` (showing ${shown.length}; narrow with dir)` : ""}\n${shown.join("\n")}`);
    }

    case "git_diff":
      return ok(await gitDiff(project, str(args, "base"), safeRelDir(str(args, "path"))));

    case "git_status": {
      const branch = (await runGit(project, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const porcelain = await runGit(project, ["status", "--porcelain=v1", "--branch"]);
      const lines = porcelain.split("\n").filter(Boolean);
      const header = lines.find((line) => line.startsWith("##")) ?? `## ${branch}`;
      // A worker's own .env or key must not surface here just because git saw it.
      const changes = lines.filter((line) => !line.startsWith("##"))
        .filter((line) => !isSecretPath(line.slice(3).split(" -> ").at(-1) ?? ""));
      const hidden = lines.filter((line) => !line.startsWith("##")).length - changes.length;
      const body = changes.length === 0 ? "Working tree clean." : changes.slice(0, 200).join("\n");
      return ok(`Branch: ${branch}\n${header}\n\n${body}` +
        (changes.length > 200 ? `\n… ${changes.length - 200} more` : "") +
        (hidden > 0 ? `\n(${hidden} path(s) withheld as secrets)` : ""));
    }

    case "git_log": {
      const raw = typeof args.limit === "number" ? args.limit : 20;
      const limit = Math.min(100, Math.max(1, Math.floor(raw)));
      const path = safeRelDir(str(args, "path"));
      const gitArgs = ["log", `-${limit}`, "--date=short", "--format=%h  %ad  %an  %s"];
      if (path) gitArgs.push("--", path);
      const out = (await runGit(project, gitArgs)).trim();
      return ok(out || "No commits.");
    }

    case "read_artifact": {
      const rel = str(args, "path") ?? "";
      if (!rel.startsWith("artifacts/")) return fail("read_artifact only reads paths under artifacts/. Use read_file for source.");
      const file = await readProjectFile(project, rel);
      return ok(file.text);
    }

    case "list_tickets": {
      const planName = str(args, "plan_file") ?? "plan.md";
      if (planName.includes("/") || planName.includes("\\") || !planName.endsWith(".md")) {
        return fail("plan_file must be a .md file directly under .omp/handoff/");
      }
      const planPath = join(project.path, HANDOFF_DIR, planName);
      if (!existsSync(planPath)) return fail(`No such plan: ${HANDOFF_DIR}/${planName}`);
      const plan = parsePlan(readFileSync(planPath, "utf8"));
      // status.md records the owner's own line of work. Ticket numbers are not
      // unique across plans, so reading it for a side plan reports another
      // plan's T1 as this one's: show no verdicts rather than wrong ones.
      const isMainPlan = planName === "plan.md";
      const states = isMainPlan ? readLatestStates(project.path) : new Map<string, string>();
      const wanted = str(args, "state");
      const rows = plan.tickets
        .map((ticket) => ({ ticket, state: states.get(ticket.id.toUpperCase()) ?? "pending" }))
        .filter((row) => !wanted || row.state === wanted);
      if (rows.length === 0) return ok(wanted ? `No tickets with state ${wanted}.` : "No tickets.");
      const body = rows.map(({ ticket, state }) =>
        `${ticket.id}  ${state}  agent=${ticket.agent || "worker"}  depends=${ticket.depends.join(",") || "none"}  ${ticket.title ?? ""}`.trimEnd());
      const note = isMainPlan ? "" :
        `\n\n(States come from ${HANDOFF_DIR}/status.md, which belongs to plan.md. This is a different plan, so every ticket reads "pending" — its own runs are reported by get_runs.)`;
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
      const summary = [...counts.entries()].map(([k, v]) => `${k}: ${v}`).join(", ");
      return ok(`${HANDOFF_DIR}/${planName} — ${rows.length} ticket(s) (${summary})\n\n${body.join("\n")}${note}`);
    }

    case "sandbox_open": {
      const info = await openSandbox(project);
      return ok(`Sandbox open at ${info.path}\nBranch ${info.branch} from ${info.base.slice(0, 12)}\n\nWrite with apply_patch, run tests with run_command, show your work with sandbox_diff. The project's own tree is untouched and nothing merges without the owner.`);
    }

    case "sandbox_diff": {
      if (!sandboxExists(project)) return fail("No sandbox is open. Use sandbox_open.");
      const out = await runGit({ ...project, path: sandboxPath(project) }, ["diff", "HEAD"]);
      const untracked = await runGit({ ...project, path: sandboxPath(project) }, ["ls-files", "--others", "--exclude-standard"]);
      const extra = untracked.trim() ? `\n\nNew files:\n${untracked.trim()}` : "";
      return ok(out.trim() ? out + extra : `No changes yet.${extra}`);
    }

    case "sandbox_discard": {
      const { removed, changedFiles } = await discardSandbox(project);
      if (!removed) return ok("No sandbox was open.");
      return ok(`Sandbox removed.${changedFiles > 0 ? ` ${changedFiles} changed file(s) were discarded.` : ""}`);
    }

    case "apply_patch": {
      const patch = typeof args.patch === "string" ? args.patch : "";
      const result = await applySandboxPatch(project, patch);
      return ok(`Applied to ${result.files.length} file(s): ${result.files.join(", ")}${result.output ? `\n${result.output}` : ""}`);
    }

    case "run_command": {
      const command = str(args, "command") ?? "";
      const argv = Array.isArray(args.args) ? args.args.filter((a): a is string => typeof a === "string") : [];
      const result = await runInSandbox(project, command, argv);
      const head = result.timedOut
        ? `${result.command} — timed out after ${Math.round(SANDBOX_TIMEOUT_MS / 1000)}s`
        : `${result.command} — exit ${result.exitCode}`;
      return ok(`${head}\n\n${result.output || "(no output)"}${result.truncated ? "\n… output truncated" : ""}`);
    }

    case "view_image":
      return images([await readProjectImage(project, args.path)], "Image");

    case "capture_page": {
      const shots = await capturePages(project, args.targets ?? args.target, {
        viewport: args.viewport,
        width: args.width,
        height: args.height,
        fullPage: args.full_page,
        waitMs: args.wait_ms,
      });
      return images(shots.images, "Screenshot", shots.notes);
    }

    case "get_handoff": {
      const files = readHandoffFiles(project.path);
      const planFile = files.find((file) => file.name === "plan.md");
      const plan = parsePlan(planFile?.content ?? "");
      const sections = files.map((file) => `## ${file.relativePath}${file.exists ? ` (updated ${new Date(file.modifiedAt ?? 0).toISOString()})` : " (missing)"}\n${file.content.trim() || "empty"}`);
      const validation = planFile?.exists
        ? `\n\n## Plan check\nTickets: ${plan.tickets.map((ticket) => `${ticket.id} (${ticket.agent || "worker"})`).join(", ") || "none"}\nErrors: ${plan.errors.join("; ") || "none"}\nWarnings: ${plan.warnings.join("; ") || "none"}`
        : "";
      return ok(sections.join("\n\n") + validation);
    }

    case "get_runs": {
      const { runs, requests } = listDispatchState(project.path);
      const runLines = runs.map((run) => {
        let usage = "";
        try {
          const breakdown = getSessionUsageBreakdown(run.sessionFile);
          const fellBack = breakdown.subagents.filter((sub) => sub.fellBack).length;
          usage = ` · cost $${breakdown.totals.cost.toFixed(2)} (foreman $${breakdown.totals.mainCost.toFixed(2)}, ${breakdown.totals.subagentCount} workers $${breakdown.totals.subagentCost.toFixed(2)}) · foreman context ${Math.round(breakdown.main.currentContextTokens / 1000)}k${fellBack ? ` · ${fellBack} workers fell back to another model` : ""}`;
        } catch {
          usage = "";
        }
        return `- run ${run.id} · ${run.state} · tickets ${run.ticketIds.join(", ")} · started ${new Date(run.startedAt).toISOString()} · from ${run.source}${usage}`;
      });
      const requestLines = requests.map((request) => `- request ${request.id} · ${request.kind === "message" ? "message" : `dispatch ${request.ticketIds.join(", ")}`} · ${request.status} · ${new Date(request.createdAt).toISOString()}`);
      return ok(`## Runs\n${runLines.join("\n") || "none"}\n\n## Approval requests\n${requestLines.join("\n") || "none"}\n\nCosts are API-equivalent estimates; subscription plans are not billed per token. Read status.md via get_handoff for per-ticket results.`);
    }

    case "write_plan": {
      const markdown = typeof args.plan_markdown === "string" ? args.plan_markdown : "";
      if (!markdown.trim()) return fail("plan_markdown is required");
      if (Buffer.byteLength(markdown) > MAX_PLAN_BYTES) return fail(`Plan is larger than ${MAX_PLAN_BYTES} bytes; split it.`);
      const plan = parsePlan(markdown);
      if (plan.errors.length > 0) {
        return fail(`Plan not saved. Fix these errors:\n- ${plan.errors.join("\n- ")}\n\n${PLAN_FORMAT_GUIDE}`);
      }
      const insideProject = (realDir: string) => realDir === project.path || realDir.startsWith(project.path + sep);
      const planFile = str(args, "plan_file");
      if (!planFile) {
        // The default used to overwrite plan.md. An outside reviewer probed
        // exactly that on 2026-09-20 and replaced 135 tickets with one. There is
        // no safe default here: say which file, every time.
        return fail(
          "plan_file is required. plan.md belongs to the owner's line of work and cannot be written through this connector — " +
          "each ticket in it is pinned by the sha256 of its own text, so replacing the file discards the evidence of every run in flight. " +
          "Write your own: plan_file: \"plan-<topic>.md\".",
        );
      }
      {
        // A second author must not land in plan.md. Each ticket there is pinned
        // by the sha256 of its own text, so rewriting the file while runs are in
        // flight throws away the evidence those runs are building.
        if (planFile.includes("/") || planFile.includes("\\") || !planFile.endsWith(".md")) {
          return fail("plan_file must be a .md file directly under .omp/handoff/, e.g. plan-math-physics.md");
        }
        if (planFile === "plan.md" || planFile === "status.md" || planFile === "decisions.md") {
          return fail(`${planFile} belongs to the main line of work. Choose another name, e.g. plan-<topic>.md`);
        }
        const target = join(project.path, HANDOFF_DIR, planFile);
        const real = realpathSync(join(project.path, HANDOFF_DIR));
        if (!insideProject(real)) return fail("Handoff directory is outside the project");
        writeFileSync(target, markdown, "utf8");
        return ok(`Saved ${HANDOFF_DIR}/${planFile}: ${plan.tickets.length} tickets (${plan.tickets.map((ticket) => ticket.id).join(", ")}).${plan.warnings.length ? `\nWarnings:\n- ${plan.warnings.join("\n- ")}` : ""}\nThis file is yours; plan.md was not touched. Dispatch from it with request_dispatch.`);
      }
    }

    case "request_dispatch": {
      const ticketIds = Array.isArray(args.ticket_ids) ? args.ticket_ids.filter((id): id is string => typeof id === "string") : undefined;
      const dispatchPlan = str(args, "plan_file");
      if (dispatchPlan) {
        // Dispatching a side plan needs the foreman to read that file. Until it
        // can, say so plainly rather than quietly running the owner's plan.md,
        // which is what an omitted plan_file would have done.
        return fail(
          `Dispatching from ${HANDOFF_DIR}/${dispatchPlan} is not wired up yet: the foreman reads plan.md. ` +
          `Your plan is saved — ask the owner to dispatch it, or to merge the tickets into plan.md when the main run is idle.`,
        );
      }
      const note = str(args, "note") ?? "";
      if (directDispatch()) {
        const run = await startDispatch(project.path, ticketIds, "chatgpt");
        return ok(`Started run ${run.id} for ${run.ticketIds.join(", ")}. Check progress later with get_runs and get_handoff.`);
      }
      const request = createDispatchRequest(project.path, ticketIds, note);
      return ok(`Approval requested (request ${request.id}) for ${request.ticketIds.join(", ")}. The owner approves it in OMP Web → Handoff. Check get_runs later.`);
    }

    case "message_foreman": {
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message || message.length > MAX_MESSAGE_CHARS) return fail(`message must be 1-${MAX_MESSAGE_CHARS} characters`);
      const runId = str(args, "run_id");
      const run = runId ? findDispatchRun(runId) : listDispatchState(project.path).runs[0];
      if (!run || run.cwd !== project.path) return fail("No run found for this project. Use get_runs.");
      if (directDispatch()) {
        const how = await messageDispatchRun(run, message);
        return ok(how === "steered" ? `Sent to the running foreman of run ${run.id}.` : `Run ${run.id} resumed with your message.`);
      }
      const request = createDispatchRequest(project.path, undefined, message, { kind: "message", runId: run.id });
      return ok(`Approval requested (request ${request.id}) to send your message to run ${run.id}. The owner approves it in OMP Web → Handoff.`);
    }

    default:
      return fail(`Unknown tool: ${name}`);
  }
}

export async function callMcpTool(name: string, rawArgs: unknown): Promise<McpToolResult> {
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs as Record<string, unknown> : {};
  try {
    if (!MCP_TOOLS.some((tool) => tool.name === name)) return fail(`Unknown tool: ${name}`);
    return await handleTool(name, args);
  } catch (error) {
    if (error instanceof ProjectAccessError || error instanceof DispatchError || error instanceof HandoffError || error instanceof WebSearchError || error instanceof SandboxError) {
      return fail(error.message);
    }
    return fail(`Tool failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
