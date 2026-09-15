"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Type } from "lucide-react";
import { OUTPUT_STYLES, type OutputStyleId } from "@/lib/output-styles";

type Translate = (key: string) => string;

export function ComposerModeBar({
  outputStyleId,
  onOutputStyleChange,
  isStreaming,
  t,
}: {
  outputStyleId: OutputStyleId;
  onOutputStyleChange: (id: OutputStyleId) => void;
  isStreaming: boolean;
  t: Translate;
}) {
  const [styleOpen, setStyleOpen] = useState(false);
  const styleRef = useRef<HTMLDivElement>(null);
  const currentStyle = OUTPUT_STYLES.find((style) => style.id === outputStyleId) ?? OUTPUT_STYLES[0];

  useEffect(() => {
    if (isStreaming) setStyleOpen(false);
  }, [isStreaming]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (styleRef.current && !styleRef.current.contains(event.target as Node)) {
        setStyleOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={styleRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="composer-plan-toggle"
        data-active={styleOpen || outputStyleId !== "default" ? "true" : "false"}
        onClick={() => { if (!isStreaming) setStyleOpen((open) => !open); }}
        disabled={isStreaming}
        aria-expanded={styleOpen}
        aria-haspopup="menu"
        title={t("chatInput.styleTitle")}
        aria-label={`${t("chatInput.styleLabel")}: ${t(currentStyle.labelKey)}`}
      >
        <Type size={11} strokeWidth={2} aria-hidden="true" />
        {t(currentStyle.labelKey)}
        <ChevronDown
          size={12}
          strokeWidth={1.8}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            opacity: 0.7,
            transform: styleOpen ? "rotate(180deg)" : "none",
            transition: "transform var(--dur-fast) var(--ease-out-warm)",
          }}
        />
      </button>
      {styleOpen && (
        <div
          className="picker-panel"
          role="menu"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 100,
            width: 260,
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <div className="picker-panel-header">
            <Type size={12} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
            <span className="picker-panel-title">{t("chatInput.styleLabel")}</span>
            <span className="picker-panel-count">{OUTPUT_STYLES.length}</span>
          </div>
          <div className="picker-thinking-cards" style={{ maxHeight: 420 }}>
            {OUTPUT_STYLES.map((style) => {
              const active = style.id === outputStyleId;
              return (
                <button
                  key={style.id}
                  type="button"
                  className="picker-thinking-card"
                  data-active={active}
                  role="menuitemradio"
                  aria-checked={active}
                  title={t(style.descriptionKey)}
                  onClick={() => {
                    setStyleOpen(false);
                    if (!active && !isStreaming) onOutputStyleChange(style.id);
                  }}
                >
                  <span className="picker-check">
                    {active && (
                      <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1.5 5 4 7.5 8.5 2.5" />
                      </svg>
                    )}
                  </span>
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(style.labelKey)}</span>
                    <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-muted)", lineHeight: 1.3, whiteSpace: "normal", textAlign: "left" }}>
                      {t(style.descriptionKey)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="picker-panel-footer">
            <span>{t("chatInput.appliesNextPrompt")}</span>
            <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>{t(currentStyle.labelKey)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
