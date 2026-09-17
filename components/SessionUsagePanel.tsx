"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, NotebookPen, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatCompactNumber } from "@/lib/format";
import {
  CONTEXT_DANGER_TOKENS,
  CONTEXT_WARN_TOKENS,
  type SessionUsageBreakdown,
  type SubagentUsage,
} from "@/lib/session-usage-types";

const POLL_MS = 15_000;

interface Props {
  sessionId: string | null;
  /** Poll only while the tab is visible. */
  active: boolean;
  onOpenHandoff: () => void;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.01) return "<$0.01";
  return `$${cost < 100 ? cost.toFixed(2) : Math.round(cost).toLocaleString("en-US")}`;
}

function contextTone(tokens: number): string {
  if (tokens >= CONTEXT_DANGER_TOKENS) return "var(--status-error, #dc2626)";
  if (tokens >= CONTEXT_WARN_TOKENS) return "var(--status-modified, #d97706)";
  return "var(--status-success, #16a34a)";
}

function shortModel(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

export function SessionUsagePanel({ sessionId, active, onOpenHandoff }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<SessionUsageBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/usage`, { cache: "no-store" });
      if (requestId !== requestRef.current) return;
      if (response.status === 404) {
        // Brand-new sessions have no transcript until the first reply lands.
        setData(null);
        setError(null);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as SessionUsageBreakdown);
      setError(null);
    } catch (e) {
      if (requestId === requestRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!active || !sessionId) return;
    void load();
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, sessionId, load]);

  if (!sessionId) {
    return (
      <EmptyState title={t("sessionUsage.title")} hint={t("sessionUsage.noSession")} />
    );
  }

  const main = data?.main;
  const contextTokens = main?.currentContextTokens ?? 0;
  const overWarn = contextTokens >= CONTEXT_WARN_TOKENS;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "auto", padding: 10, gap: 10, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Gauge size={14} strokeWidth={2} aria-hidden="true" style={{ color: "var(--accent)" }} />
        <span style={{ fontWeight: 600, color: "var(--text)" }}>{t("sessionUsage.title")}</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("sessionUsage.costNote")}</span>
        <button
          type="button"
          onClick={() => { void load(); }}
          title={t("sessionUsage.refresh")}
          aria-label={t("sessionUsage.refresh")}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, padding: 0, background: "none", border: "none", borderRadius: "var(--radius-control)", color: loading ? "var(--accent)" : "var(--text-dim)", cursor: "pointer" }}
        >
          <RefreshCw size={13} strokeWidth={2} aria-hidden="true" className={loading ? "icon-spin" : undefined} />
        </button>
      </div>

      {error && <div style={{ color: "var(--status-error, #dc2626)", fontSize: 11 }}>{error}</div>}

      {!main ? (
        <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{loading ? t("sessionUsage.loading") : t("sessionUsage.noData")}</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
            <Stat
              label={t("sessionUsage.context")}
              value={formatCompactNumber(contextTokens)}
              detail={t("sessionUsage.peak", { value: formatCompactNumber(main.peakContextTokens) })}
              color={contextTone(contextTokens)}
            />
            <Stat
              label={t("sessionUsage.total")}
              value={formatCost(data.totals.cost)}
              detail={t("sessionUsage.split", { main: formatCost(data.totals.mainCost), sub: formatCost(data.totals.subagentCost) })}
            />
            <Stat
              label={t("sessionUsage.turns")}
              value={String(main.turns)}
              detail={t("sessionUsage.subagentCount", { count: data.totals.subagentCount })}
            />
            <Stat
              label={t("sessionUsage.waiting")}
              value={String(main.waitOnlyTurns)}
              detail={formatCost(main.waitOnlyCost)}
              color={main.waitOnlyTurns > 20 ? "var(--status-modified, #d97706)" : undefined}
            />
          </div>

          {overWarn && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: "var(--radius-control)", border: `1px solid ${contextTone(contextTokens)}`, background: "var(--bg-subtle)", color: "var(--text)", lineHeight: 1.5 }}>
              <span style={{ flex: 1 }}>
                {contextTokens >= CONTEXT_DANGER_TOKENS ? t("sessionUsage.warnDanger") : t("sessionUsage.warnHigh")}
              </span>
              <button
                type="button"
                onClick={onOpenHandoff}
                style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, padding: "3px 8px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
              >
                <NotebookPen size={12} strokeWidth={2} aria-hidden="true" />
                {t("sessionUsage.openHandoff")}
              </button>
            </div>
          )}

          <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
            {t("sessionUsage.mainModels", { models: main.models.map(shortModel).join(", ") || "—" })}
          </div>

          <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 4 }}>{t("sessionUsage.subagents")}</div>
          {data.subagents.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("sessionUsage.noSubagents")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.subagents.map((sub) => <SubagentRow key={sub.path} sub={sub} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SubagentRow({ sub }: { sub: SubagentUsage }) {
  const { t } = useI18n();
  const ran = sub.models.map(shortModel).join(", ");
  return (
    <div style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", paddingLeft: 9 + (sub.depth - 1) * 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub.path}>{sub.id}</span>
        {sub.agent && <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{sub.agent}</span>}
        <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--text)" }}>{formatCost(sub.cost)}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>
        <span title={sub.resolvedModel ?? undefined}>{ran || "—"}</span>
        {sub.fellBack && (
          <span
            title={t("sessionUsage.fallbackTitle", { model: sub.resolvedModel ?? "?" })}
            style={{ color: "var(--status-modified, #d97706)", fontWeight: 600 }}
          >
            {t("sessionUsage.fallback")}
          </span>
        )}
        <span>{t("sessionUsage.rowTurns", { count: sub.turns })}</span>
        <span>{t("sessionUsage.rowStart", { value: formatCompactNumber(sub.firstPromptTokens) })}</span>
        <span style={{ color: sub.peakContextTokens >= CONTEXT_WARN_TOKENS ? contextTone(sub.peakContextTokens) : undefined }}>
          {t("sessionUsage.rowPeak", { value: formatCompactNumber(sub.peakContextTokens) })}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, detail, color }: { label: string; value: string; detail?: string; color?: string }) {
  return (
    <div style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", minWidth: 0 }}>
      <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: color ?? "var(--text)", lineHeight: 1.3 }}>{value}</div>
      {detail && <div style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint: string; icon?: React.ReactNode }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, textAlign: "center" }}>
      {icon ?? <Gauge size={26} strokeWidth={1.5} aria-hidden="true" style={{ color: "var(--text-dim)" }} />}
      <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.6, maxWidth: 260 }}>{hint}</div>
    </div>
  );
}
