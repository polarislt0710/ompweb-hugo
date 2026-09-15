"use client";

import { useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { matchAskAtToken, stripAskRecommendedSuffix } from "@/lib/ask-dialog";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function AskCustomField({
  value,
  onChange,
  labels,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  labels: readonly string[];
  t: Translate;
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const at = matchAskAtToken(value, areaRef.current?.selectionStart ?? value.length);
  const query = at?.query.trim().toLowerCase() ?? "";
  const mentions = useMemo(() => {
    return labels.map((label, index) => ({
      number: index + 1,
      label: stripAskRecommendedSuffix(label).label,
    }));
  }, [labels]);
  const filtered = !at
    ? []
    : mentions.filter((item) => {
        if (!query) return true;
        if (String(item.number).startsWith(query.replace(/\s+/g, ""))) return true;
        return item.label.toLowerCase().includes(query);
      });

  const insertMention = (number: number) => {
    const el = areaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const token = matchAskAtToken(value, caret);
    const insertion = `@${number} `;
    const next = token
      ? `${value.slice(0, token.start)}${insertion}${value.slice(caret)}`
      : `${value}${value && !value.endsWith(" ") ? " " : ""}${insertion}`;
    onChange(next);
    requestAnimationFrame(() => {
      const pos = token ? token.start + insertion.length : next.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const keepEventsOnCard = (event: KeyboardEvent<HTMLTextAreaElement> | MouseEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 600 }}>
        {t("askGrill.somethingElse")}
      </span>
      {mentions.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mentions.map((item) => (
            <button
              key={item.number}
              type="button"
              onClick={() => insertMention(item.number)}
              title={item.label}
              style={{
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            >
              @{item.number}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={areaRef}
        aria-label={t("askGrill.somethingElse")}
        value={value}
        placeholder={t("askGrill.customPlaceholder")}
        onMouseDown={keepEventsOnCard}
        onKeyDown={(event) => {
          keepEventsOnCard(event);
          if (!at || filtered.length === 0) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            insertMention(filtered[0].number);
          }
        }}
        onKeyUp={keepEventsOnCard}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: "100%",
          minHeight: 72,
          padding: 10,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--bg-panel)",
          color: "var(--text)",
          outline: "none",
          resize: "vertical",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      />
      <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>
        {t("askGrill.mentionHint")}
      </div>
      {at && filtered.length > 0 ? (
        <div
          role="listbox"
          aria-label={t("askGrill.mentionHint")}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            overflow: "hidden",
          }}
        >
          {filtered.slice(0, 8).map((item) => (
            <button
              key={item.number}
              type="button"
              role="option"
              onClick={() => insertMention(item.number)}
              style={{
                display: "flex",
                gap: 8,
                width: "100%",
                padding: "8px 10px",
                border: "none",
                background: "transparent",
                color: "var(--text)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", flexShrink: 0 }}>
                @{item.number}
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
