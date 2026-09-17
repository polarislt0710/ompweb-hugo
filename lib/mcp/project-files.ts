// Read-only project access for the ChatGPT connector.
//
// Scope is deliberately narrower than the web UI's file browser:
// - only projects ompweb knows (registered or with sessions), never the home
//   directory or its ancestors;
// - only git repos share source, and only files git would show (tracked, or
//   untracked and not ignored), so .env.local, build output and other ignored
//   files stay hidden; non-git projects share their handoff notes only;
// - a denylist for secret-looking files even when they are tracked;
// - git runs without external diff/textconv drivers or fsmonitor hooks.

import { execFile } from "child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, relative, resolve, sep } from "path";
import { promisify } from "util";
import { HANDOFF_DIR } from "../handoff-paths";
import { loadProjectRegistry, mergeProjects } from "../project-registry";
import { listAllSessions } from "../session-reader";

const execFileAsync = promisify(execFile);

export const MAX_READ_BYTES = 256 * 1024;
export const MAX_READ_LINES = 2000;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;

export class ProjectAccessError extends Error {
  constructor(readonly code: "unknown_project" | "ambiguous_project" | "denied" | "not_found" | "not_git" | "too_large" | "invalid_argument", message: string) {
    super(message);
  }
}

export interface ConnectorProject {
  name: string;
  path: string;
  git: boolean;
}

function isHomeOrAncestor(path: string): boolean {
  const home = resolve(homedir());
  const target = resolve(path);
  return target === home || home.startsWith(target.endsWith(sep) ? target : target + sep);
}

export async function listConnectorProjects(): Promise<ConnectorProject[]> {
  const sessions = await listAllSessions();
  const discovered = sessions.map((session) => session.projectRoot ?? session.cwd).filter((path): path is string => Boolean(path));
  const projects = mergeProjects(loadProjectRegistry(), discovered);
  const seen = new Set<string>();
  const out: ConnectorProject[] = [];
  for (const project of projects) {
    if (!isAbsolute(project.path) || isHomeOrAncestor(project.path) || !existsSync(project.path)) continue;
    let real: string;
    try {
      real = realpathSync(project.path);
      if (!statSync(real).isDirectory()) continue;
    } catch {
      continue;
    }
    if (seen.has(real) || isHomeOrAncestor(real)) continue;
    seen.add(real);
    out.push({ name: project.alias?.trim() || basename(real), path: real, git: existsSync(resolve(real, ".git")) });
  }
  return out;
}

/** Accepts an absolute project path or a project name (alias or folder name). */
export async function resolveConnectorProject(ref: unknown): Promise<ConnectorProject> {
  if (typeof ref !== "string" || !ref.trim()) throw new ProjectAccessError("invalid_argument", "project is required");
  const value = ref.trim();
  const projects = await listConnectorProjects();
  if (isAbsolute(value)) {
    let real = value;
    try { real = realpathSync(value); } catch { /* compared as given */ }
    const match = projects.find((project) => project.path === real);
    if (!match) throw new ProjectAccessError("unknown_project", `Not an OMP Web project: ${value}. Call list_projects.`);
    return match;
  }
  const lower = value.toLowerCase();
  const matches = projects.filter((project) => project.name.toLowerCase() === lower);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new ProjectAccessError("ambiguous_project", `Several projects are named ${value}; pass the absolute path instead.`);
  throw new ProjectAccessError("unknown_project", `Unknown project: ${value}. Call list_projects.`);
}

const SECRET_NAMES = [
  /^\.env$/i,
  /^\.env\.(?!example$|sample$|template$|defaults$)[^/]+$/i,
  /\.(pem|key|p12|pfx|keystore|jks|kdbx|ovpn)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.(npmrc|netrc|pypirc|pgpass|git-credentials)$/i,
  /^(credentials|service[-_]?account[^/]*|client_secret[^/]*|secrets?)\.(json|ya?ml|toml)$/i,
  /^ompweb-mcp-oauth\.json$/i,
];
const DENIED_SEGMENTS = new Set([".git", "node_modules", ".ssh", ".aws", ".gnupg"]);

export function isSecretPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => DENIED_SEGMENTS.has(part))) return true;
  const name = parts.at(-1) ?? "";
  return SECRET_NAMES.some((pattern) => pattern.test(name));
}

function isHandoffPath(relPath: string): boolean {
  return relPath.startsWith(`${HANDOFF_DIR}/`) && !relPath.slice(HANDOFF_DIR.length + 1).includes("/");
}

export async function runGit(project: ConnectorProject, args: string[], maxBuffer = MAX_GIT_OUTPUT_BYTES): Promise<string> {
  if (!project.git) throw new ProjectAccessError("not_git", "This project is not a git repository");
  const { stdout } = await execFileAsync("git", ["-C", project.path, "-c", "core.fsmonitor=false", "-c", "core.quotepath=false", ...args], {
    encoding: "utf8",
    maxBuffer,
    timeout: 20_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_EXTERNAL_DIFF: "" },
  });
  return stdout;
}

/** Files git would show, relative to the project root. */
export async function listVisibleFiles(project: ConnectorProject): Promise<string[]> {
  const stdout = await runGit(project, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(stdout.split("\0").filter(Boolean))].filter((file) => !isSecretPath(file));
}

/** Resolve a project-relative path, refusing escapes, secrets and git-ignored files. */
export async function resolveReadablePath(project: ConnectorProject, rawPath: unknown): Promise<{ absolute: string; relative: string }> {
  if (typeof rawPath !== "string" || !rawPath.trim()) throw new ProjectAccessError("invalid_argument", "path is required");
  const candidate = resolve(project.path, rawPath.trim());
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    throw new ProjectAccessError("not_found", `File not found: ${rawPath}`);
  }
  const rel = relative(project.path, real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new ProjectAccessError("denied", "Path is outside the project");
  const relPosix = rel.split(sep).join("/");
  if (isSecretPath(relPosix)) throw new ProjectAccessError("denied", "This file is not shared with the connector");
  if (!project.git && !isHandoffPath(relPosix)) {
    // Without git there is no reliable way to tell build output, local config
    // or private data from source, so only the handoff notes are shared.
    throw new ProjectAccessError("not_git", "Only git repositories share source files; this project shares its .omp/handoff notes only");
  }
  if (project.git && !isHandoffPath(relPosix)) {
    const tracked = await runGit(project, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", relPosix]);
    if (!tracked.split("\0").includes(relPosix)) {
      throw new ProjectAccessError("denied", "File is ignored by git or not a regular file, so it is not shared");
    }
  }
  return { absolute: real, relative: relPosix };
}

export async function readProjectFile(project: ConnectorProject, rawPath: unknown, startLine?: number, endLine?: number) {
  const { absolute, relative: rel } = await resolveReadablePath(project, rawPath);
  const stat = statSync(absolute);
  if (!stat.isFile()) throw new ProjectAccessError("invalid_argument", `${rel} is not a file`);
  if (stat.size > 4 * 1024 * 1024) throw new ProjectAccessError("too_large", `${rel} is ${stat.size} bytes; read a smaller file`);
  const buffer = readFileSync(absolute);
  if (buffer.subarray(0, 8000).includes(0)) throw new ProjectAccessError("invalid_argument", `${rel} looks binary`);
  const lines = buffer.toString("utf8").split("\n");
  const start = Math.max(1, Math.floor(startLine ?? 1));
  let end = Math.min(lines.length, Math.floor(endLine ?? start + MAX_READ_LINES - 1), start + MAX_READ_LINES - 1);
  let bytes = 0;
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const line = `${n}\t${lines[n - 1]}`;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > MAX_READ_BYTES) {
      end = n - 1;
      break;
    }
    out.push(line);
  }
  return { path: rel, totalLines: lines.length, startLine: start, endLine: end, truncated: end < lines.length, text: out.join("\n") };
}
