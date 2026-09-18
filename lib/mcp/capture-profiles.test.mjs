import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "ompweb-profiles-"));
process.env.OMP_WEB_CAPTURE_PROFILE_STORE = join(root, "store.json");
process.env.OMP_WEB_CAPTURE_PROFILE_DIR = join(root, "profiles");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  captureProfileDir,
  finishCaptureLogin,
  captureProfileForHost,
  cloneProfileForCapture,
  deleteCaptureProfile,
  listCaptureProfiles,
} = await jiti.import("./capture-profiles.ts");

process.on("exit", () => rmSync(root, { recursive: true, force: true }));

/** A profile as it exists after the owner logged in and pressed "done". */
function saved(host, { loggedIn = true } = {}) {
  const slug = host.replace(/\./g, "-");
  const dir = captureProfileDir(slug);
  mkdirSync(join(dir, "Default", "Cache"), { recursive: true });
  writeFileSync(join(dir, "Default", "Cookies"), "cookie-db");
  writeFileSync(join(dir, "Default", "Cache", "big-blob"), "x".repeat(1024));
  writeFileSync(join(dir, "SingletonLock"), "host-1234");
  writeFileSync(join(dir, "DevToolsActivePort"), "52001\n/devtools/browser/abc");
  const store = { version: 1, profiles: [] };
  try {
    Object.assign(store, JSON.parse(readFileSync(process.env.OMP_WEB_CAPTURE_PROFILE_STORE, "utf8")));
  } catch {
    // first profile
  }
  store.profiles = store.profiles.filter((profile) => profile.slug !== slug);
  store.profiles.push({ slug, host, url: `https://${host}/login`, createdAt: 1, loggedInAt: loggedIn ? 2 : null, lastUsedAt: null });
  writeFileSync(process.env.OMP_WEB_CAPTURE_PROFILE_STORE, JSON.stringify(store));
  return slug;
}

test("a session is offered only for its own host", () => {
  saved("orcagrade.com");
  assert.equal(captureProfileForHost("orcagrade.com")?.host, "orcagrade.com");
  assert.equal(captureProfileForHost("app.orcagrade.com")?.host, "orcagrade.com", "subdomains of the saved host count");
  assert.equal(captureProfileForHost("example.com"), null);
  // The guard that matters: a lookalike domain must not borrow the session.
  assert.equal(captureProfileForHost("notorcagrade.com"), null);
  assert.equal(captureProfileForHost("orcagrade.com.evil.net"), null);
});

test("the most specific saved host wins", () => {
  saved("app.orcagrade.com");
  assert.equal(captureProfileForHost("app.orcagrade.com")?.host, "app.orcagrade.com");
  deleteCaptureProfile("app-orcagrade-com");
});

test("a login that was never finished is not used", () => {
  saved("halfway.example");
  assert.equal(captureProfileForHost("halfway.example")?.host, "halfway.example");
  saved("halfway.example", { loggedIn: false });
  assert.equal(captureProfileForHost("halfway.example"), null);
  deleteCaptureProfile("halfway-example");
});

test("a capture runs on a copy: no lock files, no caches, cookies intact", () => {
  const clone = cloneProfileForCapture("orcagrade-com");
  try {
    assert.equal(readFileSync(join(clone.dir, "Default", "Cookies"), "utf8"), "cookie-db");
    assert.throws(() => statSync(join(clone.dir, "SingletonLock")), "the browser lock was copied");
    // Left in place, the next browser reads it as its own and talks to a dead port.
    assert.throws(() => statSync(join(clone.dir, "DevToolsActivePort")), "the stale debugging port was copied");
    assert.throws(() => statSync(join(clone.dir, "Default", "Cache")), "the cache was copied");
    // The saved profile is untouched, so a captured page cannot log the owner out.
    assert.equal(readFileSync(join(captureProfileDir("orcagrade-com"), "Default", "Cookies"), "utf8"), "cookie-db");
  } finally {
    clone.dispose();
  }
  assert.throws(() => statSync(clone.dir), "the copy outlived the capture");
});

test("forgetting a session deletes its cookies from disk", () => {
  const slug = saved("gone.example");
  assert.ok(listCaptureProfiles().some((profile) => profile.slug === slug));
  deleteCaptureProfile(slug);
  assert.equal(listCaptureProfiles().some((profile) => profile.slug === slug), false);
  assert.throws(() => statSync(captureProfileDir(slug)));
});

test("finishing a login with no live window refuses instead of claiming a session", async () => {
  saved("closed.example", { loggedIn: false });
  // Nothing is listening on that profile's debugging port, so there is no session
  // to read: saying "signed in" here would produce logged-out shots labelled otherwise.
  await assert.rejects(() => finishCaptureLogin("closed-example"), /log in/i);
  assert.equal(captureProfileForHost("closed.example"), null);
  deleteCaptureProfile("closed-example");
});
