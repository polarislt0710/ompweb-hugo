"use client";

import { useEffect, useState } from "react";
import type { ExtensionUiRequest } from "@/lib/types";
import {
  ASK_SELECT_OTHER,
  expandAskOptionMentions,
  isAskSelectDoneLabel,
  isAskSelectMulti,
  isAskSelectOtherLabel,
  mentionableAskLabels,
  parseAskSelectTitle,
  stashAskSelectCustom,
  stripAskRecommendedSuffix,
} from "@/lib/ask-dialog";
import { useI18n } from "@/lib/i18n";
import { AskCustomField } from "./AskCustomField";

type SelectRequest = Extract<ExtensionUiRequest, { method: "select" }>;

export function SelectAskCard({
  request,
  onRespond,
  attached = false,
}: {
  request: SelectRequest;
  onRespond: (
    request: SelectRequest,
    response: { value: string } | { cancelled: true },
  ) => void;
  attached?: boolean;
}) {
  const { t } = useI18n();
  const parsed = parseAskSelectTitle(request.title);
  const multi = isAskSelectMulti(request.title, request.options);
  const otherLabel = request.options.find(isAskSelectOtherLabel) ?? ASK_SELECT_OTHER;
  const doneLabel = request.options.find(isAskSelectDoneLabel);
  const choices = request.options
    .map((label, index) => ({ label, index, detail: request.optionDetails?.[index] }))
    .filter((option) => !isAskSelectOtherLabel(option.label) && !isAskSelectDoneLabel(option.label));

  const [questionKey, setQuestionKey] = useState(parsed.question);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [custom, setCustom] = useState("");

  useEffect(() => {
    const nextKey = parseAskSelectTitle(request.title).question;
    if (nextKey === questionKey) return;
    setQuestionKey(nextKey);
    setChecked(new Set());
    setCustom("");
  }, [questionKey, request.title]);

  const submitChoice = (label: string) => {
    if (multi && !isAskSelectDoneLabel(label) && !isAskSelectOtherLabel(label)) {
      setChecked((current) => {
        const next = new Set(current);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      });
    }
    onRespond(request, { value: label });
  };

  const mentionLabels = mentionableAskLabels(choices.map((choice) => choice.label));

  const submitCustom = () => {
    const text = custom.trim();
    if (!text) return;
    stashAskSelectCustom(expandAskOptionMentions(text, mentionLabels));
    onRespond(request, { value: otherLabel });
  };

  return (
    <div
      className={attached ? undefined : "animate-fade-in"}
      onMouseDown={attached ? undefined : (event) => {
        if (event.target === event.currentTarget) onRespond(request, { cancelled: true });
      }}
      style={attached ? { width: "100%", flexShrink: 0 } : {
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "var(--overlay-backdrop)",
      }}
    >
      <div
        role="dialog"
        aria-modal={attached ? undefined : "true"}
        aria-label={parsed.question}
        className={attached ? undefined : "animate-scale-in"}
        style={{
          width: attached ? "100%" : "min(560px, 100%)",
          maxHeight: attached ? "min(480px, 55dvh)" : "min(640px, calc(100dvh - 40px))",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: attached ? "var(--radius-card)" : "var(--radius-modal)",
          background: "var(--bg)",
          boxShadow: attached ? "var(--shadow-card)" : "var(--shadow-modal)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 650, lineHeight: 1.35 }}>
            {t("askGrill.defaultTitle")}
          </div>
          <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            {parsed.question}
          </div>
          {multi ? (
            <div style={{ marginTop: 6, color: "var(--accent)", fontSize: 11, fontWeight: 600 }}>
              {t("askGrill.multiHint")}
              {checked.size > 0 || parsed.selectedCount > 0
                ? ` · ${checked.size || parsed.selectedCount}`
                : ""}
            </div>
          ) : null}
        </div>

        <div
          role={multi ? "group" : "radiogroup"}
          aria-label={parsed.question}
          style={{ padding: 14, display: "grid", gap: 8, minHeight: 0, overflowY: "auto", flex: 1 }}
        >
          {choices.map((option, choiceIndex) => {
            const display = stripAskRecommendedSuffix(option.label);
            const isOn = multi ? checked.has(option.label) : false;
            return (
              <button
                key={`${questionKey}-${option.index}`}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={isOn}
                onClick={() => submitChoice(option.label)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${isOn ? "var(--accent)" : "var(--border)"}`,
                  background: isOn
                    ? "color-mix(in srgb, var(--accent) 12%, var(--bg-panel))"
                    : "var(--bg-panel)",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18,
                      height: 18,
                      marginTop: 2,
                      borderRadius: multi ? 4 : 999,
                      border: `1px solid ${isOn ? "var(--accent)" : "var(--border)"}`,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      background: isOn ? "var(--accent)" : "transparent",
                      color: isOn ? "var(--on-accent)" : "transparent",
                    }}
                  >
                    {multi ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2 5.2 4.1 7.2 8 2.8" />
                      </svg>
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                    )}
                  </span>
                  <span style={{ display: "grid", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {choiceIndex + 1}. {display.label}
                      {display.recommended ? (
                        <span style={{ marginLeft: 8, color: "var(--text-dim)", fontWeight: 500, fontSize: 11 }}>
                          {t("askGrill.recommended")}
                        </span>
                      ) : null}
                    </span>
                    {option.detail?.description ? (
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {option.detail.description}
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ padding: "0 14px 12px", flexShrink: 0 }}>
          <AskCustomField
            value={custom}
            onChange={setCustom}
            labels={mentionLabels}
            t={t}
          />
        </div>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
        >
          <button
            type="button"
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {t("askGrill.skip")}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {doneLabel ? (
              <button
                type="button"
                onClick={() => submitChoice(doneLabel)}
                disabled={checked.size === 0 && parsed.selectedCount === 0 && !custom.trim()}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {t("askGrill.continue")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={submitCustom}
              disabled={!custom.trim()}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: `1px solid ${custom.trim() ? "var(--accent-strong)" : "var(--border)"}`,
                background: custom.trim() ? "var(--accent-strong)" : "var(--bg-subtle)",
                color: custom.trim() ? "var(--on-accent)" : "var(--text-dim)",
                cursor: custom.trim() ? "pointer" : "not-allowed",
                opacity: custom.trim() ? 1 : 0.65,
              }}
            >
              {t("askGrill.somethingElse")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
