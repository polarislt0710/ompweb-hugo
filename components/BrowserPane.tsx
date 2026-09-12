"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe, RefreshCw } from "lucide-react";
import {
  BROWSER_PANE_STORAGE_KEY,
  DEFAULT_BROWSER_URL,
  inspectBrowserUrl,
  readBrowserPaneState,
  writeBrowserPaneState,
  type EmbedPolicy,
} from "@/lib/browser-pane";
import { useI18n } from "@/lib/i18n";

export function BrowserPane({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(DEFAULT_BROWSER_URL);
  const [committed, setCommitted] = useState(DEFAULT_BROWSER_URL);
  const [reloadKey, setReloadKey] = useState(0);
  const [embedPolicy, setEmbedPolicy] = useState<EmbedPolicy | "checking">("allowed");

  const decision = useMemo(() => inspectBrowserUrl(committed), [committed]);

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
    let cancelled = false;
    setEmbedPolicy("checking");
    fetch(`/api/browser/embed-check?url=${encodeURIComponent(decision.href)}`)
      .then((response) => response.json() as Promise<{ policy?: EmbedPolicy }>)
      .then((payload) => {
        if (cancelled) return;
        setEmbedPolicy(payload.policy === "blocked" ? "blocked" : "allowed");
      })
      .catch(() => {
        if (!cancelled) setEmbedPolicy("allowed");
      });
    return () => {
      cancelled = true;
    };
  }, [decision]);

  const go = () => {
    setCommitted(draft.trim() || DEFAULT_BROWSER_URL);
    setReloadKey((value) => value + 1);
  };

  const openSystem = (href = committed) => {
    const inspected = inspectBrowserUrl(href);
    const target = inspected.href;
    if (!target) return;
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const showFrame = decision.ok && embedPolicy === "allowed";
  const showChecking = decision.ok && embedPolicy === "checking";
  const fallbackReason = !decision.ok
    ? decision.reason
    : embedPolicy === "blocked"
      ? "frame-blocked"
      : null;

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
        }}
      >
        <Globe size={14} style={{ marginTop: 8, color: "var(--text-dim)", flexShrink: 0 }} />
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
        <button type="submit" className="shell-toolbar-btn ui-focus-ring" title={t("browserPane.load")} aria-label={t("browserPane.load")}>
          {t("browserPane.go")}
        </button>
        <button type="button" className="shell-toolbar-btn ui-focus-ring" title={t("browserPane.reload")} aria-label={t("browserPane.reload")} onClick={() => setReloadKey((value) => value + 1)}>
          <RefreshCw size={13} />
        </button>
        <button type="button" className="shell-toolbar-btn ui-focus-ring" title={t("browserPane.openSystem")} aria-label={t("browserPane.openSystem")} onClick={() => openSystem()}>
          <ExternalLink size={13} />
        </button>
      </form>

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
      ) : (
        <div style={{ flex: 1, padding: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ color: "var(--text)", fontWeight: 650, marginBottom: 8 }}>{t("browserPane.cannotEmbed")}</div>
          <p style={{ margin: "0 0 12px" }}>
            {t(`browserPane.reason.${fallbackReason ?? "invalid"}`)}
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
