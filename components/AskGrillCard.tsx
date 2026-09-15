"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { ExtensionAskDialogQuestion, ExtensionUiRequest } from "@/lib/types";
import { encodeAskSubmit, isAskMulti, isOtherOptionLabel, questionHasAnswer } from "@/lib/ask-dialog";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useI18n } from "@/lib/i18n";

type AskRequest = Extract<ExtensionUiRequest, { method: "ask" }>;

export function AskGrillCard({
  request,
  onRespond,
  attached = false,
}: {
  request: AskRequest;
  onRespond: (
    request: AskRequest,
    response: { value: string } | { cancelled: true },
  ) => void;
  attached?: boolean;
}) {
  const { t } = useI18n();
  const questions = request.questions ?? [];
  const [index, setIndex] = useState(0);
  const [selectedById, setSelectedById] = useState<Record<string, number[]>>({});
  const [customById, setCustomById] = useState<Record<string, string>>({});
  const customInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setIndex(0);
    const recommended: Record<string, number[]> = {};
    for (const question of questions) {
      if (
        typeof question.recommended === "number"
        && question.options[question.recommended] !== undefined
        && !isOtherOptionLabel(question.options[question.recommended]?.label ?? "")
      ) {
        recommended[question.id] = [question.recommended];
      }
    }
    setSelectedById(recommended);
    setCustomById({});
  }, [request.id]);

  const question: ExtensionAskDialogQuestion | undefined = questions[index];
  const total = questions.length;
  const panelRef = useModalDialog<HTMLDivElement>({
    onClose: () => onRespond(request, { cancelled: true }),
    active: !attached,
  });

  const canAdvance = useMemo(() => {
    if (!question) return false;
    return questionHasAnswer(question, selectedById, customById);
  }, [question, selectedById, customById]);

  if (!question) {
    return null;
  }

  const multi = isAskMulti(question);

  const toggleOption = (optionIndex: number) => {
    const option = question.options[optionIndex];
    if (option && isOtherOptionLabel(option.label)) {
      customInputRef.current?.focus();
      return;
    }
    setSelectedById((current) => {
      const selected = current[question.id] ?? [];
      const next = multi
        ? selected.includes(optionIndex)
          ? selected.filter((item) => item !== optionIndex)
          : [...selected, optionIndex]
        : [optionIndex];
      return { ...current, [question.id]: next };
    });
    if (!multi) {
      setCustomById((current) => ({ ...current, [question.id]: "" }));
    }
  };

  const submitAll = () => {
    onRespond(request, { value: encodeAskSubmit(questions, selectedById, customById) });
  };

  const goNext = () => {
    if (!canAdvance) return;
    if (index >= total - 1) {
      submitAll();
      return;
    }
    setIndex((current) => Math.min(current + 1, total - 1));
  };

  const selected = selectedById[question.id] ?? [];
  const customValue = customById[question.id] ?? "";

  const keepEventsOnCard = (event: KeyboardEvent<HTMLTextAreaElement> | MouseEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
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
        ref={panelRef}
        role="dialog"
        aria-modal={attached ? undefined : "true"}
        aria-label={question.header || question.question}
        tabIndex={-1}
        className={attached ? undefined : "animate-scale-in"}
        style={{
          position: "relative",
          zIndex: 2,
          width: attached ? "100%" : "min(560px, 100%)",
          maxHeight: attached ? "min(480px, 55dvh)" : "min(640px, calc(100dvh - 40px))",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: attached ? "var(--radius-card)" : "var(--radius-modal)",
          background: "var(--bg)",
          boxShadow: attached ? "var(--shadow-card)" : "var(--shadow-modal)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 650, lineHeight: 1.35 }}>
              {question.header || t("askGrill.defaultTitle")}
            </div>
            {total > 1 && (
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                {index + 1} / {total}
              </div>
            )}
          </div>
          <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            {question.question}
          </div>
          {multi ? (
            <div style={{ marginTop: 6, color: "var(--accent)", fontSize: 11, fontWeight: 600 }}>
              {t("askGrill.multiHint")}
            </div>
          ) : null}
        </div>

        <div
          role={multi ? "group" : "radiogroup"}
          aria-label={question.question}
          style={{ padding: 14, display: "grid", gap: 8, minHeight: 0, overflowY: "auto", flex: 1 }}
        >
          {question.options.map((option, optionIndex) => {
            if (isOtherOptionLabel(option.label)) return null;
            const isOn = selected.includes(optionIndex);
            const recommended = question.recommended === optionIndex;
            return (
              <button
                key={`${question.id}-${optionIndex}`}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={isOn}
                onClick={() => toggleOption(optionIndex)}
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
                      {option.label}
                      {recommended ? (
                        <span style={{ marginLeft: 8, color: "var(--text-dim)", fontWeight: 500, fontSize: 11 }}>
                          {t("askGrill.recommended")}
                        </span>
                      ) : null}
                    </span>
                    {option.description ? (
                      <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                        {option.description}
                      </span>
                    ) : null}
                    {isOn && option.preview ? (
                      <span style={{ marginTop: 6, padding: "7px 8px", borderLeft: "2px solid var(--accent)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                        {option.preview}
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ padding: "0 14px 12px", flexShrink: 0 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 600 }}>
              {t("askGrill.somethingElse")}
            </span>
            <textarea
              ref={customInputRef}
              aria-label={t("askGrill.somethingElse")}
              value={customValue}
              placeholder={t("askGrill.customPlaceholder")}
              onMouseDown={keepEventsOnCard}
              onKeyDown={keepEventsOnCard}
              onKeyUp={keepEventsOnCard}
              onChange={(event) => {
                const next = event.target.value;
                setCustomById((current) => ({ ...current, [question.id]: next }));
                if (!multi && next.trim()) {
                  setSelectedById((current) => ({ ...current, [question.id]: [] }));
                }
              }}
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
          </label>
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
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {t("askGrill.back")}
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={!canAdvance}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: `1px solid ${canAdvance ? "var(--accent-strong)" : "var(--border)"}`,
                background: canAdvance ? "var(--accent-strong)" : "var(--bg-subtle)",
                color: canAdvance ? "var(--on-accent)" : "var(--text-dim)",
                cursor: canAdvance ? "pointer" : "not-allowed",
                opacity: canAdvance ? 1 : 0.65,
              }}
            >
              {index >= total - 1 ? t("askGrill.continue") : t("askGrill.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
