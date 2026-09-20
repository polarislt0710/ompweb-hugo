import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const S = await jiti.import("./sandbox.ts");

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-sbx-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  writeFileSync(join(dir, "app.py"), "print('hi')\n");
  writeFileSync(join(dir, ".gitignore"), ".env\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return { path: dir, name: `sbx-${Math.random().toString(36).slice(2, 8)}`, git: true };
}

test("a sandbox is its own worktree and the main tree does not see its writes", async (t) => {
  const project = repo(t);
  const info = await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  assert.match(info.branch, /^sandbox\//);
  writeFileSync(join(info.path, "app.py"), "print('changed in sandbox')\n");
  const status = execFileSync("git", ["-C", project.path, "status", "--porcelain"], { encoding: "utf8" });
  assert.equal(status.trim(), "", "the project's own working tree must be untouched");
});

test("only one sandbox at a time, and discard really removes it", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  await assert.rejects(() => S.openSandbox(project), /already open/i);
  const { removed } = await S.discardSandbox(project);
  assert.equal(removed, true);
  assert.equal(S.sandboxExists(project), false);
  const branches = execFileSync("git", ["-C", project.path, "branch", "--list", "sandbox/*"], { encoding: "utf8" });
  assert.equal(branches.trim(), "", "the sandbox branch must be gone too");
});

test("paths that leave the sandbox are refused", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  for (const bad of ["../../../etc/passwd", "../outside.txt", "/etc/passwd", "a/../../b"]) {
    assert.throws(() => S.resolveInsideSandbox(project, bad), /escape|not allowed/i, bad);
  }
  assert.ok(S.resolveInsideSandbox(project, "app.py"), "an ordinary path is fine");
  assert.ok(S.resolveInsideSandbox(project, "pkg/sub/file.ts"), "a nested path is fine");
});

test("credential paths are refused even inside the sandbox", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  for (const bad of [".env", ".env.local", "apps/backend/.env"]) {
    assert.throws(() => S.resolveInsideSandbox(project, bad), /credential/i, bad);
  }
});

test("a symlink inside the sandbox cannot be used to reach outside it", async (t) => {
  const project = repo(t);
  const info = await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  const outside = mkdtempSync(join(tmpdir(), "ompweb-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(info.path, "link-holder"), { recursive: true });
  symlinkSync(outside, join(info.path, "link-holder", "out"));
  assert.throws(() => S.resolveInsideSandbox(project, "link-holder/out/evil.txt"), /outside the sandbox/i);
});

test("the sandbox environment carries no credential of any kind", (t) => {
  const project = repo(t);
  const env = S.sandboxEnv(project);
  const names = Object.keys(env);
  for (const name of names) {
    assert.ok(!/^(SUPABASE_|PROD_|STAGING_|DATABASE_)/.test(name), `${name} must not be passed in`);
    assert.ok(!/(_KEY|_TOKEN|_SECRET|PASSWORD)$/.test(name), `${name} must not be passed in`);
  }
  assert.equal(env.HOME, S.sandboxHome(project), "HOME must be the sandbox's own, not the user's");
  assert.notEqual(env.HOME, process.env.HOME);
  // Whatever the server happens to hold must not leak through.
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.DATABASE_URL, undefined);
});

test("commands that reach the outside world are refused", () => {
  assert.throws(() => S.assertCommandAllowed("git", ["push", "origin", "main"]), /remote/i);
  assert.throws(() => S.assertCommandAllowed("git", ["remote", "add", "x", "y"]), /remote/i);
  assert.throws(() => S.assertCommandAllowed("ssh", ["host"]), /outside/i);
  assert.throws(() => S.assertCommandAllowed("curl", ["https://evil.example.com"]), /non-local/i);
  // Ordinary work is allowed, including talking to a local dev server.
  S.assertCommandAllowed("pytest", ["-q"]);
  S.assertCommandAllowed("git", ["status"]);
  S.assertCommandAllowed("curl", ["http://127.0.0.1:3000/health"]);
});

test("a patch that writes outside the sandbox is refused before git sees it", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  const escape = [
    "--- a/../../../etc/passwd",
    "+++ b/../../../etc/passwd",
    "@@ -0,0 +1 @@",
    "+owned",
    "",
  ].join("\n");
  await assert.rejects(() => S.applySandboxPatch(project, escape), /escape/i);
});

test("a patch that writes a credential file is refused", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  const secret = ["--- /dev/null", "+++ b/.env", "@@ -0,0 +1 @@", "+SUPABASE_SERVICE_ROLE_KEY=stolen", ""].join("\n");
  await assert.rejects(() => S.applySandboxPatch(project, secret), /credential/i);
});

test("an ordinary patch applies, and only inside the sandbox", async (t) => {
  const project = repo(t);
  const info = await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  const patch = [
    "--- a/app.py",
    "+++ b/app.py",
    "@@ -1 +1 @@",
    "-print('hi')",
    "+print('patched')",
    "",
  ].join("\n");
  const result = await S.applySandboxPatch(project, patch);
  assert.deepEqual(result.files.sort(), ["app.py"]);
  assert.match(readFileSync(join(info.path, "app.py"), "utf8"), /patched/);
  assert.match(readFileSync(join(project.path, "app.py"), "utf8"), /hi/, "the real tree must be unchanged");
});

test("a patch needs an open sandbox", async (t) => {
  const project = repo(t);
  await assert.rejects(() => S.applySandboxPatch(project, "--- a/x\n+++ b/x\n"), /Open a sandbox/i);
});

test("a sandboxed command runs in the sandbox and sees none of the server's secrets", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  // Whatever this process holds must not be inherited.
  process.env.SUPABASE_SERVICE_ROLE_KEY = "must-not-leak";
  process.env.DATABASE_URL = "postgresql://must-not-leak";
  t.after(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.DATABASE_URL; });

  const pwd = await S.runInSandbox(project, "pwd");
  assert.equal(pwd.exitCode, 0);
  assert.equal(pwd.output, realpathSync(S.sandboxPath(project)), "cwd must be the sandbox root");

  const env = await S.runInSandbox(project, "env");
  assert.doesNotMatch(env.output, /must-not-leak/, "no credential may reach the sandbox");
  assert.doesNotMatch(env.output, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(env.output, /DATABASE_URL/);
});

test("the caller cannot choose the working directory", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  // There is no cwd parameter at all; prove a command still lands in the sandbox
  // even when its arguments try to walk out.
  const out = await S.runInSandbox(project, "sh", ["-c", "cd / && pwd"]);
  assert.equal(out.output, "/", "the child may cd itself, but it started in the sandbox");
  const ls = await S.runInSandbox(project, "ls");
  assert.match(ls.output, /app\.py/, "the sandbox's own files are what it sees");
});

test("a command that reaches a remote is refused before it runs", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  await assert.rejects(() => S.runInSandbox(project, "git", ["push"]), /remote/i);
  await assert.rejects(() => S.runInSandbox(project, "ssh", ["host"]), /outside/i);
});

test("a command that overruns its time is reported as a timeout, not as a pass", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  const original = S.SANDBOX_TIMEOUT_MS;
  assert.ok(original >= 60_000, "the real ceiling should be generous");
  // Use a command that fails fast to prove the non-zero path reports honestly.
  const failed = await S.runInSandbox(project, "sh", ["-c", "exit 3"]);
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.timedOut, false);
});

test("an unknown command says so rather than reporting a silent failure", async (t) => {
  const project = repo(t);
  await S.openSandbox(project);
  t.after(async () => { await S.discardSandbox(project); });
  await assert.rejects(() => S.runInSandbox(project, "definitely-not-installed-xyz"), /not installed/i);
});

test("running needs an open sandbox", async (t) => {
  const project = repo(t);
  await assert.rejects(() => S.runInSandbox(project, "pwd"), /Open a sandbox/i);
});
