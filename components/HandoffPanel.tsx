"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, NotebookPen, Pencil, PenLine, RefreshCw, Save, SquarePlus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DispatchSection } from "./DispatchSection";
import { MarkdownBody } from "./MarkdownBody";
import { EmptyState } from "./SessionUsagePanel";

const FILE_NAMES = ["plan.md", "status.md", "decisions.md"] as const;
type FileName = (typeof FILE_NAMES)[number];

interface HandoffFile {
  name: FileName;
  relativePath: string;
  exists: boolean;
  content: string;
  modifiedAt: number | null;
}

interface Props {
  cwd: string | null;
  /** True when a session is open, so the "ask agent to write" prompt has somewhere to go. */
  hasSession: boolean;
  active: boolean;
  onInsertPrompt: (text: string) => void;
  onStartFreshSession: (cwd: string, prompt: string) => void;
  onOpenDispatchRun: (sessionId: string) => void;
}

export function HandoffPanel({ cwd, hasSession, active, onInsertPrompt, onStartFreshSession, onOpenDispatchRun }: Props) {
  const { t } = useI18n();
  const [files, setFiles] = useState<HandoffFile[]>([]);
  const [selected, setSelected] = useState<FileName>("status.md");
  const [drafts, setDrafts] = useState<Partial<Record<FileName, string>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planVersion, setPlanVersion] = useState(0);
  // These files are markdown, and are read far more often than they are edited,
  // so the panel shows them rendered until the owner asks to type.
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/handoff?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      setFiles(Array.isArray(body.files) ? body.files as HandoffFile[] : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setFiles([]);
    setDrafts({});
    setError(null);
  }, [cwd]);

  useEffect(() => {
    if (active && cwd) void load();
  }, [active, cwd, load]);

  if (!cwd) {
    return (
      <EmptyState
        title={t("handoff.title")}
        hint={t("sessionSidebar.selectProjectFirst")}
        icon={<NotebookPen size={26} strokeWidth={1.5} aria-hidden="true" style={{ color: "var(--text-dim)" }} />}
      />
    );
  }

  const file = files.find((f) => f.name === selected);
  const saved = file?.content ?? "";
  const value = drafts[selected] ?? saved;
  const dirty = drafts[selected] !== undefined && drafts[selected] !== saved;
  const written = files.filter((f) => f.exists && f.content.trim().length > 0);
  const anyExists = written.length > 0;
  const resumeMentions = written.map((f) => `@${f.relativePath}`).join(" ");

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/handoff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, name: selected, content: value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      const next = body.file as HandoffFile;
      setFiles((prev) => prev.some((f) => f.name === next.name) ? prev.map((f) => f.name === next.name ? next : f) : [...prev, next]);
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[selected];
        return copy;
      });
      setError(null);
      if (next.name === "plan.md") setPlanVersion((version) => version + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const buttonStyle = (enabled: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 9px",
    fontSize: 11,
    fontWeight: 600,
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-control)",
    background: "var(--bg)",
    color: enabled ? "var(--text)" : "var(--text-dim)",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.6,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, padding: 10, gap: 8, fontSize: 12, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <NotebookPen size={14} strokeWidth={2} aria-hidden="true" style={{ color: "var(--accent)" }} />
        <span style={{ fontWeight: 600, color: "var(--text)" }}>{t("handoff.title")}</span>
        <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>.omp/handoff/</span>
        <button
          type="button"
          onClick={() => { void load(); }}
          title={t("handoff.reload")}
          aria-label={t("handoff.reload")}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, padding: 0, background: "none", border: "none", borderRadius: "var(--radius-control)", color: loading ? "var(--accent)" : "var(--text-dim)", cursor: "pointer" }}
        >
          <RefreshCw size={13} strokeWidth={2} aria-hidden="true" className={loading ? "icon-spin" : undefined} />
        </button>
      </div>

      <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.5 }}>{t("handoff.hint")}</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button
          type="button"
          disabled={!hasSession}
          onClick={() => onInsertPrompt(t("handoff.writePrompt"))}
          title={hasSession ? t("handoff.writeTitle") : t("handoff.needSession")}
          style={buttonStyle(hasSession)}
        >
          <PenLine size={12} strokeWidth={2} aria-hidden="true" />
          {t("handoff.write")}
        </button>
        <button
          type="button"
          disabled={!anyExists}
          onClick={() => onStartFreshSession(cwd, t("handoff.resumePrompt", { files: resumeMentions }))}
          title={anyExists ? t("handoff.resumeTitle") : t("handoff.resumeEmpty")}
          style={buttonStyle(anyExists)}
        >
          <SquarePlus size={12} strokeWidth={2} aria-hidden="true" />
          {t("handoff.resume")}
        </button>
      </div>

      <DispatchSection
        cwd={cwd}
        active={active}
        planVersion={planVersion}
        onOpenRun={onOpenDispatchRun}
        planDirty={drafts["plan.md"] !== undefined && drafts["plan.md"] !== (files.find((f) => f.name === "plan.md")?.content ?? "")}
      />

      <div role="tablist" aria-label={t("handoff.title")} style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)" }}>
        {FILE_NAMES.map((name) => {
          const isSelected = name === selected;
          const info = files.find((f) => f.name === name);
          const isDirty = drafts[name] !== undefined && drafts[name] !== (info?.content ?? "");
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelected(name)}
              style={{ padding: "5px 9px", fontSize: 11, border: "none", borderBottom: `2px solid ${isSelected ? "var(--accent)" : "transparent"}`, background: "none", color: isSelected ? "var(--text)" : "var(--text-muted)", fontWeight: isSelected ? 600 : 400, cursor: "pointer" }}
            >
              {t(`handoff.file.${name.replace(".md", "")}`)}
              {isDirty ? " •" : info && !info.exists ? ` ${t("handoff.missing")}` : ""}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setEditing((on) => !on)}
          title={editing ? t("handoff.read") : t("handoff.edit")}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", fontSize: 11, border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer" }}
        >
          {editing ? <Eye size={12} strokeWidth={2} aria-hidden="true" /> : <Pencil size={12} strokeWidth={2} aria-hidden="true" />}
          {editing ? t("handoff.read") : t("handoff.edit")}
        </button>
      </div>

      {!editing ? (
        <div
          onDoubleClick={() => setEditing(true)}
          title={t("handoff.edit")}
          style={{ flex: 1, minHeight: 160, overflow: "auto", padding: "4px 10px", fontSize: 12, lineHeight: 1.6, color: "var(--text)", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)" }}
        >
          {value.trim()
            ? <MarkdownBody cwd={cwd ?? undefined}>{value}</MarkdownBody>
            : <span style={{ color: "var(--text-dim)" }}>{t(`handoff.placeholder.${selected.replace(".md", "")}`)}</span>}
        </div>
      ) : (
      <textarea
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setDrafts((prev) => ({ ...prev, [selected]: next }));
        }}
        placeholder={t(`handoff.placeholder.${selected.replace(".md", "")}`)}
        spellCheck={false}
        style={{ flex: 1, minHeight: 160, resize: "none", padding: 8, fontSize: 12, lineHeight: 1.55, fontFamily: "var(--font-mono)", color: "var(--text)", background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", outline: "none" }}
      />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {error && <span style={{ color: "var(--status-error, #dc2626)", fontSize: 11, flex: 1 }}>{error}</span>}
        {!error && file?.modifiedAt && (
          <span style={{ color: "var(--text-dim)", fontSize: 11, flex: 1 }}>
            {t("handoff.updated", { time: new Date(file.modifiedAt).toLocaleString() })}
          </span>
        )}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => { void save(); }}
          style={{ ...buttonStyle(dirty && !saving), marginLeft: "auto" }}
        >
          <Save size={12} strokeWidth={2} aria-hidden="true" />
          {saving ? t("handoff.saving") : t("handoff.save")}
        </button>
      </div>
    </div>
  );
}
