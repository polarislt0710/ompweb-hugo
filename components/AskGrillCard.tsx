"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { ExtensionAskDialogQuestion, ExtensionUiRequest } from "@/lib/types";
import { encodeAskSubmit, questionHasAnswer } from "@/lib/ask-dialog";
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
  const [customOpenById, setCustomOpenById] = useState<Record<string, boolean>>({});
  const customInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setIndex(0);
    const recommended: Record<string, number[]> = {};
    for (const question of questions) {
      if (
        typeof question.recommended === "number"
        && question.options[question.recommended] !== undefined
      ) {
        recommended[question.id] = [question.recommended];
      }
    }
    setSelectedById(recommended);
    setCustomById({});
    setCustomOpenById({});
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

  const toggleOption = (optionIndex: number) => {
    setSelectedById((current) => {
      const selected = current[question.id] ?? [];
      const next = question.multi
        ? selected.includes(optionIndex)
          ? selected.filter((item) => item !== optionIndex)
          : [...selected, optionIndex]
        : [optionIndex];
      return { ...current, [question.id]: next };
    });
    setCustomOpenById((current) => ({ ...current, [question.id]: false }));
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
  const customOpen = Boolean(customOpenById[question.id]);
  const customValue = customById[question.id] ?? "";

  useEffect(() => {
    if (!customOpen) return;
    customInputRef.current?.focus();
  }, [customOpen, question.id]);

  const openCustom = () => {
    setCustomOpenById((current) => ({ ...current, [question.id]: true }));
    if (!question.multi) {
      setSelectedById((current) => ({ ...current, [question.id]: [] }));
    }
  };

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
          border: "1px solid var(--border)",
          borderRadius: attached ? "var(--radius-card)" : "var(--radius-modal)",
          background: "var(--bg)",
          boxShadow: attached ? "var(--shadow-card)" : "var(--shadow-modal)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
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
        </div>

        <div style={{ padding: 14, display: "grid", gap: 8 }}>
          {question.options.map((option, optionIndex) => {
            const isOn = selected.includes(optionIndex);
            const recommended = question.recommended === optionIndex;
            return (
              <button
                key={`${question.id}-${optionIndex}`}
                type="button"
                onClick={() => toggleOption(optionIndex)}
                aria-pressed={isOn}
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
                  <span style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    border: `1px solid ${isOn ? "var(--accent)" : "var(--border)"}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    flexShrink: 0,
                    background: isOn ? "var(--accent)" : "transparent",
                    color: isOn ? "var(--on-accent)" : "var(--text-muted)",
                  }}
                  >
                    {optionIndex + 1}
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
                  </span>
                </div>
              </button>
            );
          })}

          <button
            type="button"
            onClick={openCustom}
            aria-pressed={customOpen}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px dashed ${customOpen ? "var(--accent)" : "var(--border)"}`,
              background: customOpen ? "color-mix(in srgb, var(--accent) 8%, var(--bg))" : "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 13,
            }}
          >
            {t("askGrill.somethingElse")}
          </button>
          {customOpen && (
            <textarea
              ref={customInputRef}
              autoFocus
              aria-label={t("askGrill.somethingElse")}
              value={customValue}
              placeholder={t("askGrill.customPlaceholder")}
              onMouseDown={keepEventsOnCard}
              onKeyDown={keepEventsOnCard}
              onKeyUp={keepEventsOnCard}
              onChange={(event) => {
                const next = event.target.value;
                setCustomById((current) => ({ ...current, [question.id]: next }));
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
          )}
        </div>

        <div style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-panel)",
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
