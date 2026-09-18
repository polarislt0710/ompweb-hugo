// Signed-in screenshots.
//
// capture_page normally opens a clean browser, so anything behind a login comes
// back as the login page. That is useless for the job the reviewer is actually
// given — compare the built dashboard against the mockup — so the owner can log
// in once, by hand, in a real Chrome window, and the session is kept as a browser
// profile on this machine.
//
// Two rules make that safe enough to ship:
//   - A profile is only ever used for the host it was created for. A capture of
//     any other host still opens a clean browser.
//   - Captures never touch the saved profile: each one runs on a throwaway copy,
//     so a page cannot log the owner out, and two captures cannot fight over the
//     browser's profile lock.
//
// It is still a real session. A page fetched with it is fetched as the owner, so
// a URL that acts on a GET (sign out, delete, approve) would act for real. The
// owner is told that, and chooses which hosts get a profile.

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getAgentDir } from "../omp/paths";
import { resolveChromeBinary } from "../chrome-path";
import { browserWebSocketUrl, DevTools, type CaptureCookie } from "./capture";

export interface CaptureProfile {
  /** Filesystem-safe id, derived from the host. */
  slug: string;
  /** The profile is used for this host and its subdomains, and nothing else. */
  host: string;
  /** Where the login window was pointed, so the owner recognises the entry. */
  url: string;
  createdAt: number;
  /** Set when the owner said the login was done; unset means "not usable yet". */
  loggedInAt: number | null;
  lastUsedAt: number | null;
}

interface ProfileStore {
  version: 1;
  profiles: CaptureProfile[];
}

export class CaptureProfileError extends Error {}

/** Caches and crash reports are re-created on demand; copying them costs seconds. */
const SKIP_DIRS = new Set([
  "Cache", "Code Cache", "GPUCache", "GrShaderCache", "ShaderCache", "DawnCache",
  "DawnGraphiteCache", "DawnWebGPUCache", "component_crx_cache", "extensions_crx_cache",
  "Crashpad", "Safe Browsing", "optimization_guide_model_store", "Service Worker",
]);

function storePath(): string {
  return process.env.OMP_WEB_CAPTURE_PROFILE_STORE || join(getAgentDir(), "ompweb-capture-profiles.json");
}

function profilesDir(): string {
  return process.env.OMP_WEB_CAPTURE_PROFILE_DIR || join(getAgentDir(), "ompweb-capture-profiles");
}

export function captureProfileDir(slug: string): string {
  return join(profilesDir(), slug);
}

function readStore(): ProfileStore {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as Partial<ProfileStore>;
    if (!Array.isArray(parsed.profiles)) return { version: 1, profiles: [] };
    return { version: 1, profiles: parsed.profiles.filter((profile) => profile && typeof profile.slug === "string") };
  } catch {
    return { version: 1, profiles: [] };
  }
}

function writeStore(store: ProfileStore): void {
  const target = storePath();
  mkdirSync(join(target, ".."), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(temporary, target);
  try {
    chmodSync(target, 0o600);
  } catch {
    // best effort; the file was created 0600 either way
  }
}

/** "orcagrade.com" → "orcagrade-com", so the directory name is predictable and safe. */
function slugFor(host: string): string {
  return host.toLowerCase().replace(/[^a-z0-9.-]/g, "").replace(/\./g, "-").slice(0, 60) || "site";
}

function normaliseUrl(raw: unknown): URL {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new CaptureProfileError("A page address is required, e.g. https://orcagrade.com/login");
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CaptureProfileError(`${text} is not a valid address`);
  }
  if (!url.hostname) throw new CaptureProfileError(`${text} has no host`);
  return url;
}

export function listCaptureProfiles(): CaptureProfile[] {
  return readStore().profiles
    .filter((profile) => existsSync(captureProfileDir(profile.slug)))
    .sort((a, b) => a.host.localeCompare(b.host));
}

/** The saved session for a host, or null. Subdomains of a saved host match too. */
export function captureProfileForHost(host: string): CaptureProfile | null {
  const wanted = host.toLowerCase();
  const matches = listCaptureProfiles()
    .filter((profile) => profile.loggedInAt !== null)
    .filter((profile) => wanted === profile.host || wanted.endsWith(`.${profile.host}`));
  // Prefer the most specific host, so a profile for app.example.com wins over one for example.com.
  return matches.sort((a, b) => b.host.length - a.host.length)[0] ?? null;
}

export function touchCaptureProfile(slug: string): void {
  const store = readStore();
  const profile = store.profiles.find((entry) => entry.slug === slug);
  if (!profile) return;
  profile.lastUsedAt = Date.now();
  writeStore(store);
}

// ---------------------------------------------------------------------------
// Logging in
// ---------------------------------------------------------------------------

/** Login windows this server started, so the owner can be told one is still open. */
const openLogins = new Map<string, ChildProcess>();

export function isLoginWindowOpen(slug: string): boolean {
  const child = openLogins.get(slug);
  if (!child) return false;
  if (child.exitCode !== null || child.signalCode !== null) {
    openLogins.delete(slug);
    return false;
  }
  return true;
}

/**
 * Open a real Chrome window on this machine, pointed at the page, using the
 * profile directory for its host. The owner logs in there by hand: nothing here
 * sees or stores a password, only whatever cookies the site sets.
 */
export function startCaptureLogin(rawUrl: unknown): CaptureProfile {
  const url = normaliseUrl(rawUrl);
  const host = url.hostname.toLowerCase();
  const slug = slugFor(host);
  if (isLoginWindowOpen(slug)) throw new CaptureProfileError(`A login window for ${host} is already open.`);

  const chrome = resolveChromeBinary();
  if (!chrome) throw new CaptureProfileError("No Chrome, Chromium or Edge found on this machine.");

  const dir = captureProfileDir(slug);
  mkdirSync(profilesDir(), { recursive: true, mode: 0o700 });
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const child = spawn(chrome, [
    `--user-data-dir=${dir}`,
    // Bound to loopback on a port Chrome picks. It is how the finished session
    // is read out of this window; it closes with the window.
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-service-autorun",
    "--new-window",
    url.toString(),
  ], { stdio: "ignore" });
  child.on("error", () => openLogins.delete(slug));
  child.on("exit", () => openLogins.delete(slug));
  openLogins.set(slug, child);

  const store = readStore();
  const existing = store.profiles.find((profile) => profile.slug === slug);
  const profile: CaptureProfile = existing ?? {
    slug,
    host,
    url: url.toString(),
    createdAt: Date.now(),
    loggedInAt: null,
    lastUsedAt: null,
  };
  profile.url = url.toString();
  profile.host = host;
  if (!existing) store.profiles.push(profile);
  writeStore(store);
  return profile;
}

function cookiesPath(slug: string): string {
  return join(profilesDir(), `${slug}.cookies.json`);
}

/**
 * Read the session out of the open login window before closing it.
 *
 * Chrome only writes cookies that carry an expiry to disk, and plenty of sites
 * sign you in with a session cookie, which would be gone the moment the window
 * closed. Asking the live browser for its cookies is the only way to keep those.
 */
async function exportCookies(slug: string, dir: string): Promise<number> {
  let browser: DevTools | undefined;
  try {
    browser = await DevTools.connect(await browserWebSocketUrl(dir, 4000));
    const result = await browser.send("Storage.getCookies") as { cookies?: unknown[] };
    const cookies = Array.isArray(result.cookies) ? result.cookies : [];
    writeFileSync(cookiesPath(slug), JSON.stringify(cookies), { mode: 0o600 });
    return cookies.length;
  } finally {
    browser?.close();
  }
}

/** The main browser process for a profile, found by its command line. */
function loginProcessIds(dir: string): number[] {
  try {
    return execFileSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
      .split("\n")
      .filter((line) => line.includes(`--user-data-dir=${dir}`) && !line.includes("--type="))
      .map((line) => Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/** The owner says the login is done: keep the session, then close the window. */
export async function finishCaptureLogin(slug: unknown): Promise<CaptureProfile & { cookieCount: number }> {
  const id = typeof slug === "string" ? slug : "";
  const store = readStore();
  const profile = store.profiles.find((entry) => entry.slug === id);
  if (!profile) throw new CaptureProfileError("No such capture login.");
  const dir = captureProfileDir(id);

  let cookieCount = 0;
  let exportFailed = "";
  try {
    cookieCount = await exportCookies(id, dir);
  } catch (error) {
    // An older window (or one the owner already closed) has nothing to read;
    // fall back to whatever Chrome wrote to the profile on its way out.
    exportFailed = error instanceof Error ? error.message : String(error);
  }

  const child = openLogins.get(id);
  if (child && child.exitCode === null) child.kill("SIGTERM");
  openLogins.delete(id);
  // The server may have restarted since the window opened, losing the handle.
  // Chrome flushes its cookie database on quit, so it must be asked, not killed.
  for (const pid of loginProcessIds(dir)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }

  if (exportFailed) {
    // Without the session read out of the live window there is nothing to
    // promise: Chrome only writes cookies that carry an expiry, and plenty of
    // sites sign you in with one that does not. Saying "signed in" here would
    // hand the reviewer logged-out screenshots labelled as logged in.
    throw new CaptureProfileError(
      `The login window was already closed, so nothing could be kept (${exportFailed}). Open it again, log in, and press this before closing the window.`,
    );
  }
  profile.loggedInAt = Date.now();
  writeStore(store);
  return { ...profile, cookieCount };
}

/** The cookies kept when the owner finished logging in, for one capture. */
export function readSavedCookies(slug: string): CaptureCookie[] {
  try {
    const parsed = JSON.parse(readFileSync(cookiesPath(slug), "utf8")) as CaptureCookie[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function deleteCaptureProfile(slug: unknown): void {
  const id = typeof slug === "string" ? slug : "";
  const child = openLogins.get(id);
  if (child && child.exitCode === null) child.kill("SIGTERM");
  openLogins.delete(id);
  const store = readStore();
  store.profiles = store.profiles.filter((profile) => profile.slug !== id);
  writeStore(store);
  rmSync(captureProfileDir(id), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  rmSync(cookiesPath(id), { force: true });
}

// ---------------------------------------------------------------------------
// Using a profile for one capture
// ---------------------------------------------------------------------------

/**
 * A throwaway copy of the saved profile, for one capture run. The copy is why a
 * captured page cannot change the stored session, and why two captures of the
 * same site can run at once without fighting over Chrome's profile lock.
 */
export function cloneProfileForCapture(slug: string): { dir: string; dispose: () => void } {
  const source = captureProfileDir(slug);
  if (!existsSync(source)) throw new CaptureProfileError(`The saved session for ${slug} is gone; log in again.`);
  const dir = mkdtempSync(join(tmpdir(), "ompweb-profile-"));
  cpSync(source, dir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    // Chrome's own lock files would make the copy look like a running browser.
    filter: (from) => {
      const name = from.slice(from.lastIndexOf("/") + 1);
      // Singleton* is the browser's profile lock; DevToolsActivePort would point
      // the next browser at the dead port of the window this profile came from.
      if (name.startsWith("Singleton") || name === "DevToolsActivePort") return false;
      return !SKIP_DIRS.has(name);
    },
  });
  return {
    dir,
    dispose: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }),
  };
}
