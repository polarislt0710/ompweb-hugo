"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppWindow, ExternalLink, Globe, RefreshCw } from "lucide-react";
import {
  BROWSER_PANE_STORAGE_KEY,
  DEFAULT_BROWSER_URL,
  browserPaneSurface,
  inspectBrowserUrl,
  readBrowserPaneState,
  writeBrowserPaneState,
  type EmbedPolicy,
} from "@/lib/browser-pane";
import {
  cdpModifiers,
  isCdpSessionId,
  isHostChord,
  keydownToCdp,
  keyupToCdp,
  mapCanvasToViewport,
  mouseButtonName,
  pointerToCanvasOffset,
  type CdpInputEvent,
  type ScreencastMetrics,
} from "@/lib/cdp-input";
import { useI18n } from "@/lib/i18n";

type DialogState = { message: string; dialogType: string; defaultPrompt: string };

function paneKey(sessionId: string | null): string {
  if (sessionId && isCdpSessionId(sessionId)) return sessionId;
  return "anon";
}

async function postCdp(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; code?: string }> {
  const response = await fetch("/api/browser/cdp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    return await response.json() as { ok?: boolean; error?: string; code?: string };
  } catch {
    return { error: "Live Chrome request failed", code: "cdp_failed" };
  }
}

export function BrowserPane({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(DEFAULT_BROWSER_URL);
  const [committed, setCommitted] = useState(DEFAULT_BROWSER_URL);
  const [reloadKey, setReloadKey] = useState(0);
  const [embedPolicy, setEmbedPolicy] = useState<EmbedPolicy | "checking">("allowed");
  const [cdpError, setCdpError] = useState<{ message: string; code: string } | null>(null);
  const [cdpStatus, setCdpStatus] = useState<"starting" | "live" | "stopped" | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<{ data: string; metadata: ScreencastMetrics; imageWidth: number; imageHeight: number } | null>(null);
  const inputQueue = useRef<CdpInputEvent[]>([]);
  const flushTimer = useRef<number | null>(null);

  const decision = useMemo(() => inspectBrowserUrl(committed), [committed]);
  const surface = browserPaneSurface(decision, embedPolicy);
  const liveId = paneKey(sessionId);

  useEffect(() => {
    try {
      const stored = readBrowserPaneState(localStorage.getItem(BROWSER_PANE_STORAGE_KEY), sessionId);
      setDraft(stored.url);
      setCommitted(stored.url);
    } catch {
      // Browser pane still works with defaults when storage is blocked.
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    try {
      const next = writeBrowserPaneState(
        localStorage.getItem(BROWSER_PANE_STORAGE_KEY),
        sessionId,
        { url: committed, open: true },
      );
      localStorage.setItem(BROWSER_PANE_STORAGE_KEY, next);
    } catch {
      // Persistence is optional.
    }
  }, [sessionId, committed]);

  useEffect(() => {
    if (!decision.ok) {
      setEmbedPolicy("blocked");
      return;
    }
    if (decision.kind === "loopback") {
      setEmbedPolicy("allowed");
      return;
    }
    setEmbedPolicy("blocked");
  }, [decision]);

  const go = () => {
    setCommitted(draft.trim() || DEFAULT_BROWSER_URL);
    setReloadKey((value) => value + 1);
    setCdpError(null);
  };

  const openSystem = (href = committed) => {
    const inspected = inspectBrowserUrl(href);
    const target = inspected.href;
    if (!target) return;
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const flushInput = useCallback(() => {
    flushTimer.current = null;
    const events = inputQueue.current;
    if (events.length === 0) return;
    inputQueue.current = [];
    void postCdp({ action: "input", sessionId: liveId, events });
  }, [liveId]);

  const queueInput = useCallback((events: CdpInputEvent[]) => {
    inputQueue.current.push(...events);
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(flushInput, 24);
  }, [flushInput]);

  useEffect(() => {
    if (surface !== "cdp" || !decision.ok) return;
    let cancelled = false;
    const source = new EventSource(`/api/browser/cdp/events?sessionId=${encodeURIComponent(liveId)}`);
    source.onmessage = (message) => {
      if (cancelled || !message.data) return;
      let payload: {
        type?: string;
        data?: string;
        metadata?: ScreencastMetrics;
        url?: string;
        title?: string;
        message?: string;
        code?: string;
        dialogType?: string;
        defaultPrompt?: string;
        state?: string;
      };
      try {
        payload = JSON.parse(message.data) as typeof payload;
      } catch {
        return;
      }
      if (payload.type === "frame" && typeof payload.data === "string") {
        setCdpStatus("live");
        const image = new Image();
        image.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          frameRef.current = {
            data: payload.data ?? "",
            metadata: payload.metadata ?? { offsetTop: 0, pageScaleFactor: 1, deviceWidth: image.width, deviceHeight: image.height },
            imageWidth: image.width,
            imageHeight: image.height,
          };
          paintFrame(canvas, image);
        };
        image.src = `data:image/jpeg;base64,${payload.data}`;
        return;
      }
      if (payload.type === "navigated" && typeof payload.url === "string") {
        setDraft(payload.url);
        return;
      }
      if (payload.type === "dialog") {
        setDialog({
          message: payload.message ?? "",
          dialogType: payload.dialogType ?? "alert",
          defaultPrompt: payload.defaultPrompt ?? "",
        });
        return;
      }
      if (payload.type === "error") {
        setCdpError({ message: payload.message ?? "Live Chrome failed", code: payload.code ?? "cdp_failed" });
        return;
      }
      if (payload.type === "status" && (payload.state === "starting" || payload.state === "live" || payload.state === "stopped")) {
        setCdpStatus(payload.state);
      }
    };
    source.onerror = () => {
      if (!cancelled) setCdpStatus((current) => current ?? "starting");
    };

    const canvas = canvasRef.current;
    const boot = () => {
      const size = measureCanvas(canvasRef.current);
      void postCdp({
        action: "ensure",
        sessionId: liveId,
        url: decision.href,
        ...size,
      }).then((result) => {
        if (cancelled) return;
        if (result.code) setCdpError({ message: result.error ?? "Live Chrome failed", code: result.code });
      });
    };
    const bootFrame = window.requestAnimationFrame(boot);

    let resizeTimer: number | null = null;
    const observer = canvas
      ? new ResizeObserver(() => {
        if (resizeTimer !== null) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          resizeTimer = null;
          const size = measureCanvas(canvasRef.current);
          if (size.width < 40 || size.height < 40) return;
          void postCdp({ action: "resize", sessionId: liveId, ...size });
        }, 80);
      })
      : null;
    if (canvas && observer) observer.observe(canvas);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(bootFrame);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      source.close();
      observer?.disconnect();
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      void postCdp({ action: "stop", sessionId: liveId });
    };
  }, [surface, liveId, decision, reloadKey]);

  const showFrame = surface === "iframe" && decision.ok;
  const showChecking = surface === "checking";
  const showCdp = surface === "cdp";
  const showFallback = surface === "fallback" || (showCdp && cdpError?.code === "chrome_not_found");
  const fallbackReason = !decision.ok
    ? decision.reason
    : cdpError?.code === "chrome_not_found"
      ? "chrome-missing"
      : "frame-blocked";

  const handleReload = () => {
    if (showCdp && !showFallback) {
      void postCdp({ action: "reload", sessionId: liveId });
      return;
    }
    setReloadKey((value) => value + 1);
  };

  const handleMouse = (event: React.MouseEvent<HTMLCanvasElement>, type: "mousePressed" | "mouseReleased" | "mouseMoved") => {
    const canvas = event.currentTarget;
    const point = pointFromPointer(event, canvas, frameRef.current);
    if (!point) return;
    if (type === "mousePressed") canvas.focus();
    queueInput([{
      type,
      x: point.x,
      y: point.y,
      button: type === "mouseMoved" ? "none" : mouseButtonName(event.button),
      buttons: event.buttons,
      clickCount: type === "mousePressed" ? (event.detail || 1) : 1,
      modifiers: cdpModifiers(event),
    }]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
        style={{
          display: "flex",
          gap: 6,
          padding: 8,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
          alignItems: "center",
        }}
      >
        <Globe size={14} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("browserPane.address")}
          placeholder="https://orcagrade.com or http://127.0.0.1:8120"
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            padding: "0 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        />
        <span
          title={showCdp ? t("browserPane.imeHint") : undefined}
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 650,
            letterSpacing: 0.02,
            color: showCdp ? "var(--accent-strong)" : "var(--text-dim)",
            padding: "2px 6px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            whiteSpace: "nowrap",
          }}
        >
          {showCdp ? t("browserPane.liveChrome") : t("browserPane.iframeMode")}
        </span>
        <button type="submit" className="shell-toolbar-btn ui-focus-ring" title={t("browserPane.load")} aria-label={t("browserPane.load")}>
          {t("browserPane.go")}
        </button>
        <button type="button" className="shell-toolbar-btn ui-focus-ring" title={t("browserPane.reload")} aria-label={t("browserPane.reload")} onClick={handleReload}>
          <RefreshCw size={13} />
        </button>
        <button type="button" className="shell-toolbar-btn ui-focus-ring" title={t("browserPane.openSystem")} aria-label={t("browserPane.openSystem")} onClick={() => openSystem()}>
          <ExternalLink size={13} />
        </button>
        {showCdp && !showFallback && (
          <button
            type="button"
            className="shell-toolbar-btn ui-focus-ring"
            title={t("browserPane.focusChrome")}
            aria-label={t("browserPane.focusChrome")}
            onClick={() => void postCdp({ action: "focus", sessionId: liveId })}
          >
            <AppWindow size={13} />
          </button>
        )}
      </form>
      {showCdp && !showFallback && (
        <div style={{
          flexShrink: 0,
          padding: "6px 10px",
          fontSize: 11,
          lineHeight: 1.45,
          color: "var(--text-muted)",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
        }}>
          {t("browserPane.captchaHint")}
        </div>
      )}

      {showFrame && decision.ok ? (
        <iframe
          key={`${decision.href}:${reloadKey}`}
          title={t("browserPane.localBrowser")}
          src={decision.href}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer-when-downgrade"
          style={{ flex: 1, width: "100%", border: "none", background: "var(--bg)" }}
        />
      ) : showChecking ? (
        <div style={{ flex: 1, padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
          {t("browserPane.checking")}
        </div>
      ) : showCdp && !showFallback ? (
        <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--bg)" }}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label={t("browserPane.liveChrome")}
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => handleMouse(event, "mousePressed")}
            onMouseUp={(event) => handleMouse(event, "mouseReleased")}
            onMouseMove={(event) => handleMouse(event, "mouseMoved")}
            onWheel={(event) => {
              const canvas = event.currentTarget;
              event.preventDefault();
              const point = pointFromPointer(event, canvas, frameRef.current);
              if (!point) return;
              queueInput([{
                type: "mouseWheel",
                x: point.x,
                y: point.y,
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                modifiers: cdpModifiers(event),
              }]);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key === "Process") return;
              if (isHostChord(event)) return;
              event.preventDefault();
              queueInput(keydownToCdp(event));
            }}
            onKeyUp={(event) => {
              if (event.nativeEvent.isComposing || event.key === "Process") return;
              if (isHostChord(event)) return;
              event.preventDefault();
              queueInput([keyupToCdp(event)]);
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (!text) return;
              event.preventDefault();
              queueInput([{ type: "insertText", text }]);
            }}
            onCompositionEnd={(event) => {
              if (!event.data) return;
              queueInput([{ type: "insertText", text: event.data }]);
            }}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              outline: "none",
              cursor: "default",
            }}
          />
          {cdpStatus !== "live" && (
            <div style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: 13,
              pointerEvents: "none",
            }}>
              {cdpError ? t("browserPane.cdpError") : t("browserPane.starting")}
            </div>
          )}
          {dialog && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "color-mix(in srgb, var(--bg) 70%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}>
              <div style={{
                maxWidth: 360,
                width: "100%",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 14,
                color: "var(--text)",
                fontSize: 13,
              }}>
                <div style={{ fontWeight: 650, marginBottom: 8 }}>{dialog.dialogType}</div>
                <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>{dialog.message}</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="shell-toolbar-btn ui-focus-ring"
                    onClick={() => {
                      void postCdp({ action: "dialog", sessionId: liveId, accept: false });
                      setDialog(null);
                    }}
                  >
                    {t("browserPane.dialogDismiss")}
                  </button>
                  <button
                    type="button"
                    className="shell-toolbar-btn ui-focus-ring"
                    onClick={() => {
                      void postCdp({ action: "dialog", sessionId: liveId, accept: true, promptText: dialog.defaultPrompt });
                      setDialog(null);
                    }}
                  >
                    {t("browserPane.dialogAccept")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, padding: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ color: "var(--text)", fontWeight: 650, marginBottom: 8 }}>{t("browserPane.cannotEmbed")}</div>
          <p style={{ margin: "0 0 12px" }}>
            {t(`browserPane.reason.${fallbackReason}`)}
          </p>
          {(decision.href || committed) && (
            <button
              type="button"
              onClick={() => openSystem(decision.href ?? committed)}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--accent-strong)",
                background: "var(--accent-strong)",
                color: "var(--on-accent)",
                cursor: "pointer",
              }}
            >
              {t("browserPane.openSystem")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function measureCanvas(canvas: HTMLCanvasElement | null): { width: number; height: number; scale: number } {
  if (!canvas) return { width: 400, height: 720, scale: 1 };
  return {
    width: Math.round(canvas.clientWidth),
    height: Math.round(canvas.clientHeight),
    scale: Math.min(2, window.devicePixelRatio || 1),
  };
}

function pointFromPointer(
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  frame: { imageWidth: number; imageHeight: number; metadata: ScreencastMetrics } | null,
) {
  if (!frame) return null;
  const local = pointerToCanvasOffset(
    event.clientX,
    event.clientY,
    canvas.getBoundingClientRect(),
    canvas.clientWidth,
    canvas.clientHeight,
  );
  if (!local) return null;
  return mapCanvasToViewport({
    offsetX: local.x,
    offsetY: local.y,
    canvasWidth: canvas.clientWidth,
    canvasHeight: canvas.clientHeight,
    imageWidth: frame.imageWidth,
    imageHeight: frame.imageHeight,
    metrics: frame.metadata,
    fit: "fill",
  });
}

function paintFrame(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.max(1, Math.floor(cssW * dpr));
  const pixelH = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("background-color") || "#111";
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.drawImage(image, 0, 0, cssW, cssH);
}
