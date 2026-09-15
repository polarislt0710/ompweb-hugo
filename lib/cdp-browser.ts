import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, readFileSync, unlinkSync } from "fs";
import path from "path";
import { resolveChromeBinary } from "./chrome-path";
import {
  clampScreencastScale,
  clampViewport,
  desktopLayoutForPane,
  screencastFrameSize,
  type CdpInputEvent,
} from "./cdp-input";
import { getConfigRoot } from "./omp/paths";

/** Hide the CDP webdriver bit so a human can finish CAPTCHA in the real window. */
export const HIDE_WEBDRIVER_SOURCE =
  "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});";

const START_TIMEOUT_MS = 20_000;
const STOP_SCREENCAST_DELAY_MS = 750;
const SCREENCAST_QUALITY = 80;
const MAX_INPUT_BATCH = 32;
const MAX_INSERT_CHARS = 8_000;

export class CdpBrowserError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "CdpBrowserError";
    this.code = code;
  }
}

export type ScreencastFrameMetadata = {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
};

export type CdpClientEvent =
  | { type: "ready"; url: string; title?: string }
  | { type: "frame"; data: string; metadata: ScreencastFrameMetadata; frameId: number }
  | { type: "navigated"; url: string; title?: string }
  | { type: "dialog"; message: string; dialogType: string; defaultPrompt?: string }
  | { type: "error"; message: string; code: string }
  | { type: "status"; state: "starting" | "live" | "stopped" | "missing-chrome" };

export type CdpListener = (event: CdpClientEvent) => void;

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type TargetInfo = {
  targetId: string;
  type?: string;
  url?: string;
  openerId?: string;
};

type PageSession = {
  targetId: string;
  sessionId: string;
  url: string;
  title: string;
  screencastOn: boolean;
};

type PaneState = {
  paneId: string;
  listeners: Set<CdpListener>;
  viewport: { width: number; height: number };
  layout: { width: number; height: number };
  scale: number;
  url: string;
  root: PageSession | null;
  current: PageSession | null;
  lastFrame: Extract<CdpClientEvent, { type: "frame" }> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
};

export function parseDevToolsActivePort(text: string): { port: number; browserPath: string } | null {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const rest = (lines[1] ?? "").trim();
  if (!rest) return null;
  const browserPath = rest.startsWith("/") ? rest : `/devtools/browser/${rest}`;
  return { port, browserPath };
}

export function cdpWebSocketUrl(port: number, browserPath: string): string {
  const suffix = browserPath.startsWith("/") ? browserPath : `/${browserPath}`;
  return `ws://127.0.0.1:${port}${suffix}`;
}

export function buildChromeLaunchArgs(opts: {
  userDataDir: string;
  headed?: boolean;
  width?: number;
  height?: number;
}): string[] {
  const { width, height } = clampViewport(opts.width ?? 800, opts.height ?? 900);
  const args = [
    `--user-data-dir=${opts.userDataDir}`,
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-popup-blocking",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--disable-features=Translate,MediaRouter,PaintHolding",
    `--window-size=${width},${height}`,
    "--window-position=60,60",
    "about:blank",
  ];
  if (opts.headed === false) args.unshift("--headless=new");
  return args;
}

export function shouldFollowTarget(target: TargetInfo, currentTargetId: string | undefined): boolean {
  if (!isUsablePage(target)) return false;
  if (!currentTargetId || !target.openerId) return false;
  return target.openerId === currentTargetId;
}

export function isUsablePage(target: TargetInfo): boolean {
  if (target.type !== "page") return false;
  const url = target.url ?? "";
  if (url.startsWith("chrome-extension:") || url.startsWith("chrome://") || url.startsWith("devtools:")) return false;
  return true;
}

export function cdpProfileDir(): string {
  return path.join(getConfigRoot(), "ompweb-cdp");
}

class CdpConnection {
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private methodHandlers = new Map<string, Set<(params: Record<string, unknown>, sessionId?: string) => void>>();
  private closed = false;
  private readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : undefined;
      if (!raw) return;
      let parsed: {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        sessionId?: string;
        result?: unknown;
        error?: { message?: string };
      };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        return;
      }
      if (typeof parsed.id === "number") {
        const waiter = this.pending.get(parsed.id);
        if (!waiter) return;
        this.pending.delete(parsed.id);
        if (parsed.error) waiter.reject(new Error(`${waiter.method}: ${parsed.error.message ?? "CDP error"}`));
        else waiter.resolve(parsed.result);
        return;
      }
      if (parsed.method) {
        const handlers = this.methodHandlers.get(parsed.method);
        if (!handlers) return;
        for (const handler of handlers) handler(parsed.params ?? {}, parsed.sessionId);
      }
    });
    this.ws.addEventListener("close", () => this.rejectAll(new Error("CDP socket closed")));
    this.ws.addEventListener("error", () => this.rejectAll(new Error("CDP socket error")));
  }

  on(method: string, handler: (params: Record<string, unknown>, sessionId?: string) => void): () => void {
    let set = this.methodHandlers.get(method);
    if (!set) {
      set = new Set();
      this.methodHandlers.set(method, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP socket is not open"));
    }
    const id = ++this.nextId;
    const payload: Record<string, unknown> = { id, method };
    if (params) payload.params = params;
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    this.closed = true;
    this.rejectAll(new Error("CDP socket closed"));
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}

export type CdpBrowserDeps = {
  resolveChrome?: () => string | null;
  headed?: boolean;
  profileDir?: string;
};

export class CdpBrowserHost {
  private proc: ChildProcess | null = null;
  private conn: CdpConnection | null = null;
  private starting: Promise<void> | null = null;
  private panes = new Map<string, PaneState>();
  private sessionToPane = new Map<string, string>();
  private targetToPane = new Map<string, string>();
  private unmatchedPages = new Map<string, PageSession>();
  private unsubscribers: Array<() => void> = [];
  private readonly resolveChrome: () => string | null;
  private readonly headed: boolean;
  private readonly profileDir: string;

  constructor(deps: CdpBrowserDeps = {}) {
    this.resolveChrome = deps.resolveChrome ?? (() => resolveChromeBinary());
    this.headed = deps.headed ?? process.env.OMP_WEB_CDP_HEADLESS !== "1";
    this.profileDir = deps.profileDir ?? cdpProfileDir();
  }

  subscribe(paneId: string, listener: CdpListener): () => void {
    const pane = this.getPane(paneId);
    if (pane.stopTimer) {
      clearTimeout(pane.stopTimer);
      pane.stopTimer = null;
    }
    pane.listeners.add(listener);
    if (pane.lastFrame) listener(pane.lastFrame);
    if (pane.current) {
      listener({ type: "ready", url: pane.current.url, title: pane.current.title });
      listener({ type: "status", state: "live" });
      if (!pane.current.screencastOn) void this.startScreencast(pane);
    }
    return () => {
      pane.listeners.delete(listener);
      if (pane.listeners.size > 0) return;
      if (pane.stopTimer) clearTimeout(pane.stopTimer);
      pane.stopTimer = setTimeout(() => {
        pane.stopTimer = null;
        if (pane.listeners.size === 0) void this.stopScreencast(pane);
      }, STOP_SCREENCAST_DELAY_MS);
    };
  }

  async ensure(paneId: string, url: string, width: number, height: number, scale = 1): Promise<{ url: string }> {
    const pane = this.getPane(paneId);
    pane.viewport = clampViewport(width, height);
    pane.layout = desktopLayoutForPane(pane.viewport.width, pane.viewport.height);
    pane.scale = clampScreencastScale(scale);
    pane.url = url;
    this.emit(pane, { type: "status", state: "starting" });
    await this.startChrome();
    if (!pane.root) await this.createTab(pane);
    await this.applyViewport(pane);
    await this.navigatePane(pane, url);
    await this.startScreencast(pane);
    const current = pane.current;
    this.emit(pane, { type: "status", state: "live" });
    this.emit(pane, { type: "ready", url: current?.url ?? url, title: current?.title });
    return { url: current?.url ?? url };
  }

  async navigate(paneId: string, url: string): Promise<void> {
    const pane = this.requirePane(paneId);
    pane.url = url;
    await this.startChrome();
    if (!pane.root) await this.createTab(pane);
    await this.navigatePane(pane, url);
    await this.startScreencast(pane);
  }

  async reload(paneId: string): Promise<void> {
    const pane = this.requirePane(paneId);
    const session = this.requireSession(pane);
    await this.conn?.send("Page.reload", { ignoreCache: false }, session.sessionId);
  }

  async input(paneId: string, events: CdpInputEvent[]): Promise<void> {
    const pane = this.requirePane(paneId);
    const session = this.requireSession(pane);
    const conn = this.requireConn();
    const batch = events.slice(0, MAX_INPUT_BATCH);
    for (const event of batch) {
      if (event.type === "insertText") {
        const text = event.text.slice(0, MAX_INSERT_CHARS);
        if (text) await conn.send("Input.insertText", { text }, session.sessionId);
        continue;
      }
      if (event.type === "keyDown" || event.type === "keyUp" || event.type === "rawKeyDown" || event.type === "char") {
        await conn.send("Input.dispatchKeyEvent", event, session.sessionId);
        continue;
      }
      await conn.send("Input.dispatchMouseEvent", event, session.sessionId);
    }
  }

  async resize(paneId: string, width: number, height: number, scale = 1): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane?.current) return;
    const next = clampViewport(width, height);
    const nextScale = clampScreencastScale(scale);
    const nextLayout = desktopLayoutForPane(next.width, next.height);
    if (
      pane.viewport.width === next.width
      && pane.viewport.height === next.height
      && pane.layout.width === nextLayout.width
      && pane.layout.height === nextLayout.height
      && pane.scale === nextScale
    ) return;
    pane.viewport = next;
    pane.layout = nextLayout;
    pane.scale = nextScale;
    await this.applyViewport(pane);
    if (pane.current.screencastOn) {
      await this.stopScreencast(pane);
      await this.startScreencast(pane);
    }
  }

  async focus(paneId: string): Promise<void> {
    const pane = this.requirePane(paneId);
    const session = this.requireSession(pane);
    const conn = this.requireConn();
    try {
      await conn.send("Target.activateTarget", { targetId: session.targetId });
    } catch {
      // older Chrome
    }
    try {
      await conn.send("Page.bringToFront", {}, session.sessionId);
    } catch {
      // ignore
    }
    if (this.headed && process.platform === "darwin") {
      spawn("osascript", ["-e", 'tell application "Google Chrome" to activate'], {
        stdio: "ignore",
      });
    }
  }

  async dialog(paneId: string, accept: boolean, promptText?: string): Promise<void> {
    const pane = this.requirePane(paneId);
    const session = this.requireSession(pane);
    await this.conn?.send(
      "Page.handleJavaScriptDialog",
      { accept, promptText: promptText ?? "" },
      session.sessionId,
    );
  }

  async stop(paneId: string): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    if (pane.stopTimer) {
      clearTimeout(pane.stopTimer);
      pane.stopTimer = null;
    }
    await this.stopScreencast(pane);
    this.emit(pane, { type: "status", state: "stopped" });
  }

  async dispose(): Promise<void> {
    for (const pane of this.panes.values()) {
      if (pane.stopTimer) clearTimeout(pane.stopTimer);
      pane.listeners.clear();
    }
    this.panes.clear();
    this.sessionToPane.clear();
    this.targetToPane.clear();
    this.unmatchedPages.clear();
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.conn?.close();
    this.conn = null;
    const proc = this.proc;
    this.proc = null;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }

  private getPane(paneId: string): PaneState {
    let pane = this.panes.get(paneId);
    if (!pane) {
      pane = {
        paneId,
        listeners: new Set(),
        viewport: { width: 400, height: 720 },
        layout: desktopLayoutForPane(400, 720),
        scale: 1,
        url: "about:blank",
        root: null,
        current: null,
        lastFrame: null,
        stopTimer: null,
      };
      this.panes.set(paneId, pane);
    }
    return pane;
  }

  private requirePane(paneId: string): PaneState {
    const pane = this.panes.get(paneId);
    if (!pane?.current) throw new CdpBrowserError("Live Chrome tab is not running", "cdp_not_started");
    return pane;
  }

  private requireSession(pane: PaneState): PageSession {
    if (!pane.current) throw new CdpBrowserError("Live Chrome tab is not running", "cdp_not_started");
    return pane.current;
  }

  private requireConn(): CdpConnection {
    if (!this.conn) throw new CdpBrowserError("Live Chrome is not connected", "cdp_not_started");
    return this.conn;
  }

  private emit(pane: PaneState, event: CdpClientEvent): void {
    if (event.type === "frame") pane.lastFrame = event;
    for (const listener of pane.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors must not break the host
      }
    }
  }

  private async startChrome(): Promise<void> {
    if (this.conn && this.proc && this.proc.exitCode === null) return;
    if (this.starting) return this.starting;
    this.starting = this.startChromeInner().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startChromeInner(): Promise<void> {
    const bin = this.resolveChrome();
    if (!bin) {
      throw new CdpBrowserError(
        "Google Chrome was not found. Install Chrome or set OMP_WEB_CHROME_BIN.",
        "chrome_not_found",
      );
    }
    mkdirSync(this.profileDir, { recursive: true });
    const portFile = path.join(this.profileDir, "DevToolsActivePort");
    try {
      unlinkSync(portFile);
    } catch {
      // no previous port file
    }
    const args = buildChromeLaunchArgs({
      userDataDir: this.profileDir,
      headed: this.headed,
    });
    const proc = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME },
    });
    this.proc = proc;
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk).slice(-4_000);
    });
    proc.once("exit", () => {
      if (this.proc === proc) {
        this.proc = null;
        this.conn?.close();
        this.conn = null;
        for (const pane of this.panes.values()) {
          pane.root = null;
          pane.current = null;
          this.emit(pane, { type: "error", message: "Live Chrome exited", code: "chrome_exited" });
        }
      }
    });

    const parsed = await waitForFile(
      () => {
        if (proc.exitCode !== null) {
          throw new CdpBrowserError(
            `Chrome exited before opening a debug port${stderr ? `: ${stderr.trim()}` : ""}`,
            "chrome_exited",
          );
        }
        try {
          const parsedPort = parseDevToolsActivePort(readFileSync(portFile, "utf8"));
          if (!parsedPort) return null;
          return parsedPort;
        } catch {
          return null;
        }
      },
      START_TIMEOUT_MS,
    );
    if (!parsed) {
      throw new CdpBrowserError("Chrome did not open a debugging port", "chrome_exited");
    }

    const ws = await openCdpSocket(cdpWebSocketUrl(parsed.port, parsed.browserPath), proc);
    const conn = new CdpConnection(ws);
    this.conn = conn;
    this.bindBrowserEvents(conn);
    await conn.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    await conn.send("Target.setDiscoverTargets", { discover: true });
    await waitForFile(() => (this.unmatchedPages.size > 0 ? true : null), 3_000).catch(() => null);
  }

  private bindBrowserEvents(conn: CdpConnection): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [
      conn.on("Target.attachedToTarget", (params) => {
        void this.onAttached(params);
      }),
      conn.on("Target.detachedFromTarget", (params) => {
        this.onDetached(params);
      }),
      conn.on("Page.screencastFrame", (params, sessionId) => {
        void this.onScreencastFrame(params, sessionId);
      }),
      conn.on("Page.frameNavigated", (params, sessionId) => {
        void this.onNavigated(params, sessionId);
      }),
      conn.on("Page.navigatedWithinDocument", (params, sessionId) => {
        void this.onNavigated(params, sessionId);
      }),
      conn.on("Page.javascriptDialogOpening", (params, sessionId) => {
        void this.onDialog(params, sessionId);
      }),
    ];
  }

  private async onAttached(params: Record<string, unknown>): Promise<void> {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    const targetInfo = (params.targetInfo ?? {}) as TargetInfo;
    const waiting = params.waitingForDebugger === true;
    if (!sessionId || !targetInfo.targetId) return;
    if (waiting) {
      try {
        await this.conn?.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
      } catch {
        // attach can race with close
      }
    }
    if (!isUsablePage(targetInfo)) return;

    const page: PageSession = {
      targetId: targetInfo.targetId,
      sessionId,
      url: targetInfo.url ?? "",
      title: "",
      screencastOn: false,
    };

    const existingPaneId = this.targetToPane.get(targetInfo.targetId);
    if (existingPaneId) {
      const pane = this.panes.get(existingPaneId);
      if (pane) this.adoptSession(pane, page);
      return;
    }

    for (const pane of this.panes.values()) {
      const currentId = pane.current?.targetId;
      if (shouldFollowTarget(targetInfo, currentId) || shouldFollowTarget(targetInfo, pane.root?.targetId)) {
        await this.followPopup(pane, page);
        return;
      }
    }
    this.unmatchedPages.set(targetInfo.targetId, page);
  }

  private onDetached(params: Record<string, unknown>): void {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    if (!sessionId) return;
    const paneId = this.sessionToPane.get(sessionId);
    if (!paneId) return;
    const pane = this.panes.get(paneId);
    if (!pane) return;
    if (pane.current?.sessionId === sessionId && pane.root && pane.root.sessionId !== sessionId) {
      this.sessionToPane.delete(sessionId);
      pane.current = pane.root;
      void this.startScreencast(pane);
    }
  }

  private async onScreencastFrame(params: Record<string, unknown>, sessionId?: string): Promise<void> {
    const frameId = typeof params.sessionId === "number" ? params.sessionId : Number(params.sessionId);
    const data = typeof params.data === "string" ? params.data : "";
    const metadata = (params.metadata ?? {}) as ScreencastFrameMetadata;
    if (!sessionId || !data || !Number.isFinite(frameId)) return;
    try {
      await this.conn?.send("Page.screencastFrameAck", { sessionId: frameId }, sessionId);
    } catch {
      return;
    }
    const paneId = this.sessionToPane.get(sessionId);
    if (!paneId) return;
    const pane = this.panes.get(paneId);
    if (!pane || pane.current?.sessionId !== sessionId) return;
    this.emit(pane, {
      type: "frame",
      data,
      metadata: {
        offsetTop: Number(metadata.offsetTop) || 0,
        pageScaleFactor: Number(metadata.pageScaleFactor) || 1,
        deviceWidth: Number(metadata.deviceWidth) || pane.viewport.width,
        deviceHeight: Number(metadata.deviceHeight) || pane.viewport.height,
        scrollOffsetX: Number(metadata.scrollOffsetX) || 0,
        scrollOffsetY: Number(metadata.scrollOffsetY) || 0,
      },
      frameId,
    });
  }

  private async onNavigated(params: Record<string, unknown>, sessionId?: string): Promise<void> {
    if (!sessionId) return;
    const paneId = this.sessionToPane.get(sessionId);
    if (!paneId) return;
    const pane = this.panes.get(paneId);
    const page = pane?.current;
    if (!pane || !page || page.sessionId !== sessionId) return;
    const frame = params.frame as { url?: string; parentId?: string } | undefined;
    const url = typeof params.url === "string" ? params.url : frame?.url;
    if (!url) return;
    if (frame?.parentId) return;
    page.url = url;
    pane.url = url;
    page.title = await this.readTitle(sessionId);
    this.emit(pane, { type: "navigated", url, title: page.title });
  }

  private async onDialog(params: Record<string, unknown>, sessionId?: string): Promise<void> {
    if (!sessionId) return;
    const paneId = this.sessionToPane.get(sessionId);
    if (!paneId) return;
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const message = typeof params.message === "string" ? params.message : "";
    const dialogType = typeof params.type === "string" ? params.type : "alert";
    const defaultPrompt = typeof params.defaultPrompt === "string" ? params.defaultPrompt : "";
    if (pane.listeners.size === 0) {
      try {
        await this.conn?.send("Page.handleJavaScriptDialog", { accept: false }, sessionId);
      } catch {
        // ignore
      }
      return;
    }
    this.emit(pane, { type: "dialog", message, dialogType, defaultPrompt });
  }

  private async readTitle(sessionId: string): Promise<string> {
    try {
      const result = await this.conn?.send(
        "Runtime.evaluate",
        { expression: "document.title", returnByValue: true },
        sessionId,
      ) as { result?: { value?: unknown } } | undefined;
      return typeof result?.result?.value === "string" ? result.result.value : "";
    } catch {
      return "";
    }
  }

  private adoptSession(pane: PaneState, page: PageSession): void {
    this.sessionToPane.set(page.sessionId, pane.paneId);
    this.targetToPane.set(page.targetId, pane.paneId);
    if (!pane.root) pane.root = page;
    pane.current = page;
  }

  private async followPopup(pane: PaneState, page: PageSession): Promise<void> {
    await this.stopScreencast(pane, true);
    this.adoptSession(pane, page);
    await this.enablePage(page, pane.viewport);
    await this.startScreencast(pane);
  }

  private async createTab(pane: PaneState): Promise<void> {
    const reused = this.takeUnmatchedPage();
    if (reused) {
      this.adoptSession(pane, reused);
      await this.enablePage(reused, pane.viewport);
      return;
    }
    const conn = this.requireConn();
    const created = await conn.send("Target.createTarget", { url: "about:blank" }) as { targetId?: string };
    const targetId = created?.targetId;
    if (!targetId) throw new CdpBrowserError("Chrome did not create a tab", "cdp_not_started");
    this.targetToPane.set(targetId, pane.paneId);
    const page = await waitForFile(() => {
      if (pane.root?.targetId === targetId) return pane.root;
      if (pane.current?.targetId === targetId) return pane.current;
      const unmatched = this.unmatchedPages.get(targetId);
      if (unmatched) {
        this.unmatchedPages.delete(targetId);
        this.adoptSession(pane, unmatched);
        return unmatched;
      }
      return null;
    }, 8_000);
    if (!page) throw new CdpBrowserError("Chrome tab did not attach", "cdp_not_started");
    const session = pane.current;
    if (session) await this.enablePage(session, pane.viewport);
  }

  private takeUnmatchedPage(): PageSession | null {
    const first = this.unmatchedPages.entries().next().value;
    if (!first) return null;
    this.unmatchedPages.delete(first[0]);
    return first[1];
  }

  private async enablePage(page: PageSession, viewport: { width: number; height: number }): Promise<void> {
    const conn = this.requireConn();
    await conn.send("Page.enable", {}, page.sessionId);
    await conn.send("Runtime.enable", {}, page.sessionId);
    await conn.send("Page.setLifecycleEventsEnabled", { enabled: true }, page.sessionId);
    await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: HIDE_WEBDRIVER_SOURCE }, page.sessionId);
    try {
      await conn.send("Runtime.evaluate", { expression: HIDE_WEBDRIVER_SOURCE, returnByValue: true }, page.sessionId);
    } catch {
      // page may not have a document yet
    }
    await conn.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
  }

  private async applyViewport(pane: PaneState): Promise<void> {
    const session = pane.current;
    const conn = this.conn;
    if (!session || !conn) return;
    pane.layout = desktopLayoutForPane(pane.viewport.width, pane.viewport.height);
    await conn.send("Emulation.setDeviceMetricsOverride", {
      width: pane.layout.width,
      height: pane.layout.height,
      deviceScaleFactor: pane.scale,
      mobile: false,
    }, session.sessionId);
    try {
      const info = await conn.send("Browser.getWindowForTarget", { targetId: session.targetId }) as { windowId?: number };
      if (typeof info?.windowId === "number") {
        await conn.send("Browser.setWindowBounds", {
          windowId: info.windowId,
          bounds: {
            width: pane.layout.width,
            height: pane.layout.height + 80,
            windowState: "normal",
          },
        });
      }
    } catch {
      // headed chrome chrome-frame size is best-effort
    }
  }

  private async navigatePane(pane: PaneState, url: string): Promise<void> {
    const session = this.requireSession(pane);
    await this.conn?.send("Page.navigate", { url }, session.sessionId);
    session.url = url;
    pane.url = url;
    this.emit(pane, { type: "navigated", url });
    await delay(400);
  }

  private async startScreencast(pane: PaneState): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    if (pane.listeners.size === 0) return;
    const session = pane.current;
    if (!session) return;
    if (session.screencastOn) return;
    const start = async (page: PageSession) => {
      try {
        await conn.send("Page.bringToFront", {}, page.sessionId);
      } catch {
        // headless may reject bringToFront
      }
      const frame = screencastFrameSize(pane.layout, pane.scale);
      await conn.send("Page.startScreencast", {
        format: "jpeg",
        quality: SCREENCAST_QUALITY,
        maxWidth: frame.maxWidth,
        maxHeight: frame.maxHeight,
        everyNthFrame: 1,
      }, page.sessionId);
      page.screencastOn = true;
    };
    try {
      await start(session);
    } catch {
      const current = pane.current ?? session;
      await this.enablePage(current, pane.viewport);
      try {
        await start(current);
      } catch {
        await this.emitScreenshot(pane, current);
      }
    }
  }

  private async emitScreenshot(pane: PaneState, page: PageSession): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    const result = await conn.send("Page.captureScreenshot", { format: "jpeg", quality: SCREENCAST_QUALITY }, page.sessionId) as { data?: string };
    if (!result?.data) throw new CdpBrowserError("Live Chrome could not capture a frame", "cdp_not_started");
    this.emit(pane, {
      type: "frame",
      data: result.data,
      metadata: {
        offsetTop: 0,
        pageScaleFactor: 1,
        deviceWidth: pane.viewport.width,
        deviceHeight: pane.viewport.height,
      },
      frameId: 0,
    });
  }

  private async stopScreencast(pane: PaneState, silent = false): Promise<void> {
    const session = pane.current;
    if (!session?.screencastOn) return;
    session.screencastOn = false;
    try {
      await this.conn?.send("Page.stopScreencast", {}, session.sessionId);
    } catch {
      // tab may already be gone
    }
    if (!silent) this.emit(pane, { type: "status", state: "stopped" });
  }
}

function waitForFile<T>(read: () => T | null, timeoutMs: number): Promise<T> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const value = read();
        if (value) {
          resolve(value);
          return;
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        reject(new CdpBrowserError("Timed out waiting for Chrome", "chrome_exited"));
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openCdpSocket(url: string, proc: ChildProcess): Promise<WebSocket> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (proc.exitCode !== null) {
      throw new CdpBrowserError("Chrome exited before the debug socket opened", "chrome_exited");
    }
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("timeout"));
        }, 500);
        ws.addEventListener("open", () => {
          clearTimeout(timer);
          resolve(ws);
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("socket error"));
        });
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await delay(100);
    }
  }
  throw new CdpBrowserError(
    `Could not connect to Chrome debugging port${lastError ? `: ${lastError.message}` : ""}`,
    "chrome_exited",
  );
}

declare global {
  var __ompwebCdpBrowser: CdpBrowserHost | undefined;
}

export function getCdpBrowser(): CdpBrowserHost {
  if (!globalThis.__ompwebCdpBrowser) {
    globalThis.__ompwebCdpBrowser = new CdpBrowserHost();
    const cleanup = () => {
      void globalThis.__ompwebCdpBrowser?.dispose();
    };
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__ompwebCdpBrowser;
}
