// A git worktree an outside reviewer may write in, and nothing else.
//
// The ask was `apply_patch` plus a `run_command` limited to an allow-list of
// safe tools. That pair is not a limited shell, it is a complete one: pytest
// imports conftest.py, ruff reads pyproject.toml, npm reads package.json, make
// reads Makefile. Anything that can write a file and run a tool can run
// arbitrary code, whatever the allow-list says.
//
// So the boundary here is not which command runs. It is where it runs, and what
// it can see: a worktree off the project's own HEAD, a HOME of its own, and an
// environment built from an allow-list so no credential can be read out of it.
// Nothing here merges, commits to a real branch, or pushes.

import { execFile } from "child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, normalize, resolve, sep } from "path";
import { promisify } from "util";
import { getAgentDir } from "../omp/paths";
import { isSecretPath, runGit, type ConnectorProject } from "./project-files";

const execFileAsync = promisify(execFile);

export const SANDBOX_TIMEOUT_MS = 300_000;
export const SANDBOX_MAX_OUTPUT = 1024 * 1024;

/** Commands refused even inside the sandbox: they reach the outside world. */
const DENIED_COMMANDS = new Set(["ssh", "scp", "sftp", "rsync", "nc", "telnet"]);
const DENIED_GIT_SUBCOMMANDS = new Set(["push", "remote", "clone", "fetch", "pull", "submodule"]);

export class SandboxError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function sandboxesRoot(): string {
  return join(getAgentDir(), "sandboxes");
}

function slug(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
}

export function sandboxPath(project: ConnectorProject): string {
  return join(sandboxesRoot(), slug(project.name));
}

export function sandboxHome(project: ConnectorProject): string {
  return join(sandboxPath(project) + ".home");
}

export function sandboxExists(project: ConnectorProject): boolean {
  return existsSync(join(sandboxPath(project), ".git"));
}

/**
 * Resolve a path the caller supplied and prove it stays inside the sandbox.
 *
 * Both the lexical form and the real form are checked: the first stops `..`,
 * the second stops a symlink inside the sandbox pointing out of it.
 */
export function resolveInsideSandbox(project: ConnectorProject, relPath: string): string {
  if (!relPath || typeof relPath !== "string") throw new SandboxError("invalid_path", "A path is required");
  if (relPath.startsWith("/") || /^[a-zA-Z]:/.test(relPath)) {
    throw new SandboxError("invalid_path", `Absolute paths are not allowed: ${relPath}`);
  }
  const normalized = normalize(relPath);
  if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.split(sep).includes("..")) {
    throw new SandboxError("escape", `Path escapes the sandbox: ${relPath}`);
  }
  if (isSecretPath(normalized)) {
    throw new SandboxError("secret", `Refusing to touch a credential path: ${relPath}`);
  }
  const root = realpathSync(sandboxPath(project));
  const target = resolve(root, normalized);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new SandboxError("escape", `Path escapes the sandbox: ${relPath}`);
  }
  // A symlink already in the tree must not be used to reach outside it.
  let probe = target;
  while (probe !== root && probe.length > root.length) {
    if (existsSync(probe)) {
      const real = realpathSync(probe);
      if (real !== root && !real.startsWith(root + sep)) {
        throw new SandboxError("escape", `Path resolves outside the sandbox through a link: ${relPath}`);
      }
      break;
    }
    probe = resolve(probe, "..");
  }
  return target;
}

/** The only environment a sandboxed command gets. Built up, never filtered down. */
export function sandboxEnv(project: ConnectorProject): NodeJS.ProcessEnv {
  const home = sandboxHome(project);
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TMPDIR: join(home, "tmp"),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
    // Tools branch on this; "test" is the honest description of a sandbox run.
    NODE_ENV: "test",
    // Deliberately absent: every SUPABASE_*, PROD_*, STAGING_*, DATABASE_URL,
    // and anything ending in _KEY, _TOKEN or _SECRET.
  };
}

export function assertCommandAllowed(command: string, args: readonly string[]): void {
  const name = command.split("/").at(-1) ?? command;
  if (DENIED_COMMANDS.has(name)) {
    throw new SandboxError("denied_command", `${name} reaches outside the sandbox and is not allowed`);
  }
  if (name === "git") {
    const sub = args.find((arg) => !arg.startsWith("-"));
    if (sub && DENIED_GIT_SUBCOMMANDS.has(sub)) {
      throw new SandboxError("denied_command", `git ${sub} talks to a remote and is not allowed`);
    }
  }
  if ((name === "curl" || name === "wget") &&
      args.some((arg) => /^https?:\/\//i.test(arg) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(arg))) {
    throw new SandboxError("denied_command", `${name} to a non-local address is not allowed`);
  }
}

export interface SandboxInfo {
  path: string;
  branch: string;
  base: string;
}

export async function openSandbox(project: ConnectorProject): Promise<SandboxInfo> {
  if (!project.git) throw new SandboxError("not_git", "A sandbox needs a git project");
  if (sandboxExists(project)) {
    throw new SandboxError("already_open", `A sandbox is already open at ${sandboxPath(project)}. Discard it first.`);
  }
  const dir = sandboxPath(project);
  const home = sandboxHome(project);
  mkdirSync(sandboxesRoot(), { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, "tmp"), { recursive: true });
  // Make a push fail at the config level as well as at the command check.
  writeFileSync(join(home, ".gitconfig"), "[remote]\n\tpushDefault = sandbox-has-no-remote\n[url \"blocked://\"]\n\tinsteadOf = https://\n", "utf8");

  const base = (await runGit(project, ["rev-parse", "HEAD"])).trim();
  const branch = `sandbox/${slug(project.name)}/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await runGit(project, ["worktree", "add", "-b", branch, dir, base]);
  if (existsSync(join(dir, ".env"))) {
    // Should be impossible — .env is gitignored — but never ship the assumption.
    rmSync(join(dir, ".env"), { force: true });
  }
  return { path: dir, branch, base };
}

export async function discardSandbox(project: ConnectorProject): Promise<{ removed: boolean; changedFiles: number }> {
  if (!sandboxExists(project)) return { removed: false, changedFiles: 0 };
  let changedFiles = 0;
  try {
    const status = await execFileAsync("git", ["-C", sandboxPath(project), "status", "--porcelain"], { encoding: "utf8" });
    changedFiles = status.stdout.split("\n").filter(Boolean).length;
  } catch { /* counting is best effort; removal is not */ }
  let branch = "";
  try {
    const out = await execFileAsync("git", ["-C", sandboxPath(project), "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
    branch = out.stdout.trim();
  } catch { /* fall through */ }
  await runGit(project, ["worktree", "remove", "--force", sandboxPath(project)]).catch(() => undefined);
  rmSync(sandboxPath(project), { recursive: true, force: true });
  rmSync(sandboxHome(project), { recursive: true, force: true });
  if (branch && branch.startsWith("sandbox/")) {
    await runGit(project, ["branch", "-D", branch]).catch(() => undefined);
  }
  return { removed: true, changedFiles };
}

/** The files a unified diff would write, as repo-relative paths. */
export function patchTargets(patch: string): string[] {
  const targets = new Set<string>();
  for (const line of patch.split("\n")) {
    const m = /^(?:\+\+\+|---)\s+(?:[ab]\/)?(.+?)\s*$/.exec(line);
    if (!m) continue;
    const path = m[1];
    if (path === "/dev/null") continue;
    targets.add(path.replace(/^["']|["']$/g, ""));
  }
  return [...targets];
}

export interface PatchResult {
  files: string[];
  output: string;
}

/**
 * Apply a unified diff inside the sandbox.
 *
 * Every target is checked before git sees the patch: `git apply` already refuses
 * paths above the repo, but the guard that matters here is ours, and it also
 * covers credential paths and symlinks out of the tree.
 */
export async function applySandboxPatch(project: ConnectorProject, patch: string): Promise<PatchResult> {
  if (!sandboxExists(project)) throw new SandboxError("no_sandbox", "Open a sandbox first");
  if (!patch.trim()) throw new SandboxError("invalid_patch", "The patch is empty");
  const targets = patchTargets(patch);
  if (targets.length === 0) throw new SandboxError("invalid_patch", "No file headers found; send a unified diff");
  for (const target of targets) resolveInsideSandbox(project, target);

  const dir = sandboxPath(project);
  // git reads the patch from a file, not stdin: promisify(execFile) has no way
  // to write stdin, and a git left waiting on it simply hangs until the timeout.
  const patchFile = join(sandboxHome(project), "tmp", `patch-${Date.now()}.diff`);
  writeFileSync(patchFile, patch.endsWith("\n") ? patch : patch + "\n", "utf8");
  const run = (args: string[]) => execFileAsync("git", ["-C", dir, ...args], {
    encoding: "utf8" as const,
    timeout: 60_000,
    maxBuffer: SANDBOX_MAX_OUTPUT,
    env: sandboxEnv(project),
  });
  try {
    try {
      await run(["apply", "--check", "--whitespace=nowarn", patchFile]);
    } catch (error) {
      const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr: unknown }).stderr) : "";
      throw new SandboxError("patch_rejected", `The patch does not apply:\n${(stderr || String(error)).slice(0, 2000)}`);
    }
    const { stdout, stderr } = await run(["apply", "--whitespace=nowarn", patchFile]);
    return { files: targets, output: `${stdout ?? ""}${stderr ?? ""}`.trim() };
  } finally {
    rmSync(patchFile, { force: true });
  }
}

export interface RunResult {
  command: string;
  exitCode: number;
  timedOut: boolean;
  output: string;
  truncated: boolean;
}

/**
 * Run one command inside the sandbox.
 *
 * `cwd` is the sandbox root and is not taken from the caller: a command that
 * could choose its own directory would not be sandboxed at all. The environment
 * comes from `sandboxEnv`, which is built from an allow-list, so nothing the
 * server holds — Supabase keys, database URLs, the web password — is reachable
 * from here even though this process can see all of them.
 */
export async function runInSandbox(
  project: ConnectorProject,
  command: string,
  args: readonly string[] = [],
): Promise<RunResult> {
  if (!sandboxExists(project)) throw new SandboxError("no_sandbox", "Open a sandbox first");
  if (typeof command !== "string" || !command.trim()) throw new SandboxError("invalid_command", "A command is required");
  if (command.includes("/") && !command.startsWith("./")) {
    throw new SandboxError("invalid_command", "Give a command name, not a path");
  }
  assertCommandAllowed(command, args);

  const dir = realpathSync(sandboxPath(project));
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd: dir,
      env: sandboxEnv(project),
      timeout: SANDBOX_TIMEOUT_MS,
      maxBuffer: SANDBOX_MAX_OUTPUT,
      encoding: "utf8" as const,
      shell: false,
    });
    const output = `${stdout ?? ""}${stderr ?? ""}`;
    return { command: [command, ...args].join(" "), exitCode: 0, timedOut: false, output: output.trim(), truncated: false };
  } catch (error) {
    const err = error as { code?: number | string; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ""}${err.stderr ?? ""}` || err.message || String(error);
    const timedOut = err.killed === true || err.signal === "SIGTERM" || (Date.now() - started) >= SANDBOX_TIMEOUT_MS;
    if (err.code === "ENOENT") {
      throw new SandboxError("no_such_command", `${command} is not installed in the sandbox`);
    }
    const truncated = output.length >= SANDBOX_MAX_OUTPUT;
    return {
      command: [command, ...args].join(" "),
      // A timeout is not an exit code; say so rather than reporting a number.
      exitCode: typeof err.code === "number" ? err.code : 1,
      timedOut,
      output: (truncated ? output.slice(0, SANDBOX_MAX_OUTPUT) : output).trim(),
      truncated,
    };
  }
}
