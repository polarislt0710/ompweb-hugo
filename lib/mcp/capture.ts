// Headless Chrome driven over DevTools, so one browser can shoot several pages
// in one call: full-page, at a phone and/or desktop viewport.
//
// A one-shot `chrome --screenshot` cannot do full-page capture and pays the
// browser's cold start per page, which makes a 6-screen UI comparison slow
// enough that the reviewer stops asking for it.

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setTimeout as delay } from "timers/promises";

export interface Viewport {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

export interface CaptureRequest {
  url: string;
  /** What to call this shot in the reply (a path or the URL). */
  label: string;
  viewport: Viewport;
}

/**
 * What being signed in actually consists of. Cookies are only half of it: plenty
 * of apps keep the token in localStorage instead, and a capture that replays
 * only cookies comes back at the login screen.
 */
export interface CaptureSession {
  cookies: CaptureCookie[];
  origins: Array<{
    origin: string;
    local: Array<[string, string]>;
    session: Array<[string, string]>;
  }>;
}

/** A cookie as DevTools hands it over, and as it is handed back. */
export interface CaptureCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface CaptureResult {
  label: string;
  viewport: Viewport;
  png: Buffer;
  /** Set when the page did not load; the caller reports it instead of a picture. */
  error?: string;
}

/** Tall pages are clipped rather than returned as a multi-megabyte strip. */
const MAX_FULL_PAGE_HEIGHT = 6000;
const LOAD_TIMEOUT_MS = 20_000;
const CHROME_START_TIMEOUT_MS = 20_000;

export class DevTools {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private readonly waiters = new Map<string, Array<() => void>>();

  private constructor(private readonly socket: WebSocket) {}

  static async connect(url: string): Promise<DevTools> {
    const socket = new WebSocket(url);
    const client = new DevTools(socket);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("Could not connect to the browser"));
    });
    socket.onmessage = (event) => client.receive(String(event.data));
    return client;
  }

  private receive(raw: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof message.id === "number" ? message.id : null;
    if (id !== null) {
      const waiter = this.pending.get(id);
      if (!waiter) return;
      this.pending.delete(id);
      const error = message.error as { message?: string } | undefined;
      if (error) waiter.reject(new Error(error.message ?? "DevTools error"));
      else waiter.resolve((message.result as Record<string, unknown>) ?? {});
      return;
    }
    const method = typeof message.method === "string" ? message.method : "";
    for (const resolve of this.waiters.get(method) ?? []) resolve();
    this.waiters.delete(method);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolves on the next occurrence of a DevTools event, or on timeout. */
  async once(method: string, timeoutMs: number): Promise<void> {
    await Promise.race([
      new Promise<void>((resolve) => {
        const list = this.waiters.get(method) ?? [];
        list.push(resolve);
        this.waiters.set(method, list);
      }),
      delay(timeoutMs),
    ]);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // already gone
    }
  }
}

/**
 * Chrome writes its debugging port, then the browser target's socket path, to
 * DevToolsActivePort. Waiting for the file is how we know it is listening.
 */
async function devToolsPort(userDataDir: string, child?: ChildProcess, timeoutMs = CHROME_START_TIMEOUT_MS): Promise<{ port: string; browserPath: string }> {
  const portFile = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`The browser exited with code ${child.exitCode}`);
    if (existsSync(portFile)) {
      const [first, second] = readFileSync(portFile, "utf8").split("\n");
      if (first?.trim()) return { port: first.trim(), browserPath: second?.trim() ?? "" };
    }
    await delay(150);
  }
  throw new Error("The browser did not start in time");
}

/** The browser-wide socket, for asking a running Chrome about its cookies. */
export async function browserWebSocketUrl(userDataDir: string, timeoutMs?: number): Promise<string> {
  const { port, browserPath } = await devToolsPort(userDataDir, undefined, timeoutMs);
  if (!browserPath) throw new Error("The browser exposed no control socket");
  return `ws://127.0.0.1:${port}${browserPath}`;
}

/** The page's own DevTools socket, so no session plumbing is needed. */
async function pageWebSocketUrl(userDataDir: string, child: ChildProcess): Promise<string> {
  const { port } = await devToolsPort(userDataDir, child);
  const deadline = Date.now() + CHROME_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl?: string }>;
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // DevTools HTTP endpoint not up yet
    }
    await delay(150);
  }
  throw new Error("The browser started but exposed no page to drive");
}

/**
 * Put the owner's signed-in state back into a fresh browser.
 *
 * Cookies go in directly. Storage cannot: there is nothing to write to until a
 * document on that origin exists, so the entries are installed by a script that
 * runs before the page's own scripts on every load — which is exactly when an
 * app reads its token.
 */
async function restoreSession(page: DevTools, session: CaptureSession): Promise<void> {
  if (session.cookies.length > 0) {
    await page.send("Network.enable").catch(() => undefined);
    await page.send("Network.setCookies", { cookies: session.cookies }).catch(() => undefined);
  }
  for (const entry of session.origins) {
    if (entry.local.length === 0 && entry.session.length === 0) continue;
    const source = `(() => { try {
      if (location.origin !== ${JSON.stringify(entry.origin)}) return;
      for (const [key, value] of ${JSON.stringify(entry.local)}) localStorage.setItem(key, value);
      for (const [key, value] of ${JSON.stringify(entry.session)}) sessionStorage.setItem(key, value);
    } catch {} })();`;
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source }).catch(() => undefined);
  }
}

/**
 * Shoot every request with one browser. Failures are per-request: one page that
 * will not load must not lose the other screens in the same comparison.
 */
export async function captureAll(
  chromeBinary: string,
  requests: readonly CaptureRequest[],
  options: { fullPage: boolean; waitMs: number; profileDir?: string; session?: CaptureSession },
): Promise<CaptureResult[]> {
  // A profile directory carries a signed-in session and belongs to the caller,
  // which disposes of it; without one the browser starts clean and throwaway.
  const userDataDir = options.profileDir ?? mkdtempSync(join(tmpdir(), "ompweb-capture-"));
  // A stale port file would be read as this browser's, before it writes its own.
  rmSync(join(userDataDir, "DevToolsActivePort"), { force: true });
  const child = spawn(chromeBinary, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  let page: DevTools | undefined;
  const results: CaptureResult[] = [];
  try {
    page = await DevTools.connect(await pageWebSocketUrl(userDataDir, child));
    await page.send("Page.enable");
    if (options.session) await restoreSession(page, options.session);

    for (const request of requests) {
      try {
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: request.viewport.width,
          height: request.viewport.height,
          deviceScaleFactor: 1,
          mobile: request.viewport.mobile,
        });
        // Chrome renders its own error page for a refused connection, which
        // would come back looking like a broken UI; errorText is the honest signal.
        const navigation = await page.send("Page.navigate", { url: request.url }) as { errorText?: string };
        if (navigation.errorText) throw new Error(`${navigation.errorText} — nothing answered at ${request.url}`);
        await page.once("Page.loadEventFired", LOAD_TIMEOUT_MS);
        await delay(options.waitMs);

        let clip: Record<string, unknown> | undefined;
        if (options.fullPage) {
          const metrics = await page.send("Page.getLayoutMetrics") as { cssContentSize?: { width: number; height: number } };
          const content = metrics.cssContentSize;
          if (content) {
            clip = {
              x: 0,
              y: 0,
              width: Math.max(request.viewport.width, Math.round(content.width)),
              height: Math.min(MAX_FULL_PAGE_HEIGHT, Math.max(request.viewport.height, Math.round(content.height))),
              scale: 1,
            };
          }
        }
        const shot = await page.send("Page.captureScreenshot", {
          format: "png",
          ...(clip ? { clip, captureBeyondViewport: true } : {}),
        }) as { data: string };
        results.push({ label: request.label, viewport: request.viewport, png: Buffer.from(shot.data, "base64") });
      } catch (error) {
        results.push({
          label: request.label,
          viewport: request.viewport,
          png: Buffer.alloc(0),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  } finally {
    page?.close();
    // Let the browser finish writing its profile before the directory goes,
    // otherwise the cleanup races it and throws ENOTEMPTY.
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        delay(3000),
      ]);
    }
    if (!options.profileDir) rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
