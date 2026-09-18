"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, LogIn, Play, Plug, Send, Unplug, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n";
import type { ParsedPlan } from "@/lib/work-plan";

interface DispatchRunView {
  id: string;
  sessionId: string;
  ticketIds: string[];
  source: "web" | "chatgpt";
  startedAt: number;
  state: "running" | "idle" | "ended";
}

interface DispatchRequestView {
  id: string;
  kind?: "dispatch" | "message";
  ticketIds: string[];
  note: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected";
}

interface DispatchState {
  plan: ParsedPlan;
  planModifiedAt: number | null;
  runs: DispatchRunView[];
  requests: DispatchRequestView[];
  /** Tickets earlier runs already took, so a big plan advances instead of restarting. */
  dispatchedIds: string[];
  /** The next batch to run, in plan order. */
  suggested: string[];
}

interface ConnectorState {
  enabled: boolean;
  url: string;
  directDispatch: boolean;
  connected: Array<{ name: string; kind: string }>;
}

/** A browser session the owner logged in by hand, so capture_page can shoot past a login. */
interface CaptureProfileView {
  slug: string;
  host: string;
  url: string;
  loggedInAt: number | null;
  lastUsedAt: number | null;
  open: boolean;
}

interface Props {
  cwd: string;
  active: boolean;
  /** Bumped by the parent after plan.md is saved so the ticket check refreshes. */
  planVersion: number;
  /** Unsaved edits in plan.md: dispatching would run the saved version, so block it. */
  planDirty: boolean;
  /** Show the run's session in the chat, so the owner watches the work happen. */
  onOpenRun: (sessionId: string) => void;
}

const POLL_MS = 8_000;
const CHATGPT_URL = "https://chatgpt.com/";

/** The one action this card offers right now. */
type Step = "plan" | "dispatch" | "watch" | "review";

export function DispatchSection({ cwd, active, planVersion, planDirty, onOpenRun }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<DispatchState | null>(null);
  const [connector, setConnector] = useState<ConnectorState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showConnector, setShowConnector] = useState(false);
  const [logins, setLogins] = useState<CaptureProfileView[]>([]);
  const [loginUrl, setLoginUrl] = useState("");
  /** What the last "I'm logged in" actually kept, so a failed login is visible. */
  const [loginKept, setLoginKept] = useState<number | null>(null);
  /** The batch about to run. Editable, because the owner knows the plan's phases. */
  const [batch, setBatch] = useState("");
  const [batchTouched, setBatchTouched] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/dispatch?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      setState(body as DispatchState);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cwd]);

  const loadConnector = useCallback(async () => {
    try {
      const response = await fetch("/api/mcp-connector", { cache: "no-store" });
      if (response.ok) setConnector(await response.json() as ConnectorState);
    } catch {
      // Connector info is optional; dispatching works without it.
    }
  }, []);

  useEffect(() => {
    setState(null);
    setError(null);
  }, [cwd]);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, load, planVersion]);

  const loadLogins = useCallback(async () => {
    try {
      const response = await fetch("/api/capture-login", { cache: "no-store" });
      if (response.ok) setLogins(((await response.json()) as { profiles?: CaptureProfileView[] }).profiles ?? []);
    } catch {
      // Saved sessions are optional; capture still works logged out.
    }
  }, []);

  useEffect(() => {
    if (active) void loadConnector();
  }, [active, loadConnector]);

  useEffect(() => {
    if (active && showConnector) void loadLogins();
  }, [active, showConnector, loadLogins]);

  const plan = state?.plan;
  const suggested = state?.suggested ?? [];
  useEffect(() => {
    if (!batchTouched) setBatch(suggested.join(", "));
  }, [batchTouched, suggested.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = state?.requests.find((request) => request.status === "pending") ?? null;
  const latestRun = state?.runs[0] ?? null;
  const liveRun = latestRun && latestRun.state === "running" ? latestRun : null;
  // A plan saved after the last run means there is new work, not a finished one.
  const runCoversPlan = Boolean(latestRun && (!state?.planModifiedAt || state.planModifiedAt <= latestRun.startedAt));
  const planReady = Boolean(plan && plan.tickets.length > 0 && plan.errors.length === 0 && !planDirty);

  const step: Step = liveRun
    ? "watch"
    : latestRun && runCoversPlan && !pending
      ? "review"
      : planReady || pending
        ? "dispatch"
        : "plan";

  const runDispatch = async (payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const response = await fetch("/api/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      setError(null);
      const sessionId = (body.run as DispatchRunView | undefined)?.sessionId;
      setBatchTouched(false);
      await load();
      if (sessionId) onOpenRun(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sendToReviewer = async () => {
    const tickets = (latestRun?.ticketIds ?? []).join(", ");
    await copyText(t("dispatch.reviewPrompt", { project: cwd, tickets })).catch(() => {});
    setCopied("review");
    setTimeout(() => setCopied(null), 2500);
    window.open(CHATGPT_URL, "_blank", "noopener,noreferrer");
  };

  /** Step 1: open a real Chrome window here. The owner types the password there, not in OMP Web. */
  const startLogin = async () => {
    setBusy("login");
    try {
      const response = await fetch("/api/capture-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", url: loginUrl }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      setLogins((body.profiles as CaptureProfileView[] | undefined) ?? []);
      setLoginUrl("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Step 2: the owner is logged in — close the window and keep the session. */
  const finishLogin = async (slug: string) => {
    setBusy(`finish:${slug}`);
    try {
      const response = await fetch("/api/capture-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish", slug }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      setLogins((body.profiles as CaptureProfileView[] | undefined) ?? []);
      setLoginKept(typeof body.cookieCount === "number" ? body.cookieCount : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const forgetLogin = async (profile: CaptureProfileView) => {
    if (!window.confirm(t("dispatch.login.forgetConfirm", { host: profile.host }))) return;
    setBusy(`forget:${profile.slug}`);
    try {
      const response = await fetch(`/api/capture-login?slug=${encodeURIComponent(profile.slug)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      setLogins((body.profiles as CaptureProfileView[] | undefined) ?? []);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(t("dispatch.connector.disconnectConfirm"))) return;
    setBusy("disconnect");
    try {
      await fetch("/api/mcp-connector", { method: "DELETE" });
      await loadConnector();
    } finally {
      setBusy(null);
    }
  };

  const card: React.CSSProperties = {
    border: `1px solid ${pending ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "var(--radius-control)",
    padding: 9,
    display: "flex",
    flexDirection: "column",
    gap: 7,
    background: "var(--bg-subtle)",
  };
  const dim: React.CSSProperties = { color: "var(--text-dim)", fontSize: 11 };
  const button = (enabled: boolean, primary = false): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    padding: primary ? "7px 12px" : "4px 9px",
    fontSize: primary ? 12 : 11,
    fontWeight: 600,
    border: `1px solid ${primary && enabled ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "var(--radius-control)",
    background: primary && enabled ? "var(--accent)" : "var(--bg)",
    color: primary && enabled ? "var(--on-accent, #fff)" : enabled ? "var(--text)" : "var(--text-dim)",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.6,
  });

  const headline = step === "watch"
    ? t("dispatch.step.watch")
    : step === "review"
      ? t("dispatch.step.review")
      : pending
        ? t("dispatch.step.requested")
        : planReady
          ? t("dispatch.step.ready", { count: plan?.tickets.length ?? 0 })
          : t("dispatch.step.waiting");

  const dispatchDisabledReason = planDirty
    ? t("dispatch.saveFirst")
    : plan && plan.errors.length > 0
      ? t("dispatch.fixErrors")
      : plan && plan.tickets.length === 0
        ? t("dispatch.noTickets")
        : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontWeight: 600, color: "var(--text)", flex: 1 }}>{headline}</span>
          {plan?.title && step !== "plan" && (
            <span style={{ ...dim, maxWidth: "50%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plan.title}</span>
          )}
        </div>

        {pending?.note && (
          <div style={{ whiteSpace: "pre-wrap", color: "var(--text-muted)", maxHeight: 96, overflow: "auto" }}>{pending.note}</div>
        )}

        {step === "plan" && <div style={dim}>{t("dispatch.waitingHint")}</div>}

        {(step === "dispatch" || step === "review") && plan && plan.tickets.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {plan.tickets.map((ticket) => (
              <div key={ticket.id} style={{ display: "flex", gap: 6, fontSize: 11, minWidth: 0 }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{ticket.id}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>{ticket.title}</span>
                <span style={dim}>{ticket.agent || "worker"}</span>
              </div>
            ))}
          </div>
        )}

        {step === "dispatch" && !pending && plan && plan.tickets.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ ...dim, whiteSpace: "nowrap" }}>
              {t("dispatch.batch.label", {
                done: state?.dispatchedIds.length ?? 0,
                total: plan.tickets.length,
              })}
            </span>
            <input
              type="text"
              value={batch}
              onChange={(event) => { setBatch(event.target.value); setBatchTouched(true); }}
              placeholder={suggested.join(", ")}
              title={t("dispatch.batch.hint")}
              style={{
                flex: 1, minWidth: 0, padding: "4px 7px", fontSize: 11,
                fontFamily: "var(--font-mono)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)",
              }}
            />
          </div>
        )}

        {plan?.errors.map((message) => <div key={message} style={{ color: "var(--status-error, #dc2626)", fontSize: 11 }}>{message}</div>)}

        {step === "review" && latestRun && (
          <div style={dim}>{t("dispatch.reviewHint", { tickets: latestRun.ticketIds.join(", "), time: new Date(latestRun.startedAt).toLocaleTimeString() })}</div>
        )}

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {step === "dispatch" && pending && (
            <button type="button" disabled={Boolean(busy)} onClick={() => { void runDispatch({ action: "decide", requestId: pending.id, approve: false }, "reject"); }} style={button(!busy)}>
              <X size={12} aria-hidden="true" />{t("dispatch.request.reject")}
            </button>
          )}
          {step === "dispatch" && (
            <button
              type="button"
              disabled={Boolean(busy) || (!pending && !planReady)}
              title={dispatchDisabledReason ?? undefined}
              onClick={() => {
                const ticketIds = batch.split(/[\s,]+/).map((id) => id.trim().toUpperCase()).filter(Boolean);
                void (pending
                  ? runDispatch({ action: "decide", requestId: pending.id, approve: true }, "approve")
                  : runDispatch({ action: "start", cwd, ticketIds }, "start"));
              }}
              style={{ ...button(!busy && (Boolean(pending) || planReady), true), flex: 1 }}
            >
              <Play size={13} aria-hidden="true" />
              {busy ? t("dispatch.starting") : pending ? t("dispatch.approveAndStart") : t("dispatch.start")}
            </button>
          )}
          {step === "watch" && liveRun && (
            <button type="button" onClick={() => onOpenRun(liveRun.sessionId)} style={{ ...button(true, true), flex: 1 }}>
              <Eye size={13} aria-hidden="true" />{t("dispatch.watch")}
            </button>
          )}
          {step === "review" && (
            <>
              <button type="button" disabled={Boolean(busy) || !planReady} onClick={() => { void runDispatch({ action: "start", cwd }, "start"); }} style={button(!busy && planReady)}>
                <Play size={12} aria-hidden="true" />{t("dispatch.again")}
              </button>
              <button type="button" onClick={() => { void sendToReviewer(); }} style={{ ...button(true, true), flex: 1 }}>
                <Send size={13} aria-hidden="true" />{copied === "review" ? t("dispatch.reviewCopied") : t("dispatch.review")}
              </button>
            </>
          )}
        </div>

        {dispatchDisabledReason && step === "dispatch" && !pending && <div style={dim}>{dispatchDisabledReason}</div>}
        {error && <div style={{ color: "var(--status-error, #dc2626)", fontSize: 11 }}>{error}</div>}
      </div>

      <button
        type="button"
        onClick={() => setShowConnector((open) => !open)}
        aria-expanded={showConnector}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: 0, background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", alignSelf: "flex-start" }}
      >
        <Plug size={12} aria-hidden="true" />
        {t("dispatch.connector.toggle")}
        {connector && <span style={dim}>· {connector.connected.length > 0 ? t("dispatch.connector.connected", { count: connector.connected.length }) : t("dispatch.connector.none")}</span>}
      </button>
      {showConnector && connector && (
        <div style={{ ...card, borderColor: "var(--border)" }}>
          {!connector.enabled ? (
            <div style={dim}>{t("dispatch.connector.disabled")}</div>
          ) : (
            <>
              <div style={dim}>{t("dispatch.connector.howto")}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{connector.url}</code>
                <button type="button" onClick={() => { void copyText(connector.url).then(() => { setCopied("url"); setTimeout(() => setCopied(null), 1500); }); }} style={button(true)}>
                  {copied === "url" ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                  {copied === "url" ? t("dispatch.connector.copied") : t("dispatch.connector.copy")}
                </button>
              </div>
              <div style={dim}>{connector.directDispatch ? t("dispatch.connector.direct") : t("dispatch.connector.approval")}</div>
              <button type="button" disabled={connector.connected.length === 0 || busy === "disconnect"} onClick={() => { void disconnect(); }} style={{ ...button(connector.connected.length > 0), alignSelf: "flex-start" }}>
                <Unplug size={12} aria-hidden="true" />{t("dispatch.connector.disconnect")}
              </button>

              <div style={{ borderTop: "1px solid var(--border)", marginTop: 3, paddingTop: 7, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 11 }}>{t("dispatch.login.title")}</div>
                <div style={dim}>{t("dispatch.login.howto")}</div>

                {logins.map((profile) => (
                  <div key={profile.slug} style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                      {profile.host}
                      <span style={dim}>
                        {" · "}
                        {profile.open
                          ? t("dispatch.login.waiting")
                          : profile.loggedInAt
                            ? t("dispatch.login.saved", { date: new Date(profile.loggedInAt).toLocaleDateString() })
                            : t("dispatch.login.unfinished")}
                      </span>
                    </span>
                    {(profile.open || !profile.loggedInAt) && (
                      <button type="button" disabled={busy === `finish:${profile.slug}`} onClick={() => { void finishLogin(profile.slug); }} style={button(true, true)}>
                        <Check size={12} aria-hidden="true" />{t("dispatch.login.done")}
                      </button>
                    )}
                    <button type="button" title={t("dispatch.login.forget")} disabled={busy === `forget:${profile.slug}`} onClick={() => { void forgetLogin(profile); }} style={button(true)}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                ))}

                <form
                  onSubmit={(event) => { event.preventDefault(); if (loginUrl.trim()) void startLogin(); }}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  <input
                    type="text"
                    value={loginUrl}
                    onChange={(event) => setLoginUrl(event.target.value)}
                    placeholder={t("dispatch.login.placeholder")}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "4px 7px",
                      fontSize: 11,
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-control)",
                      background: "var(--bg)",
                      color: "var(--text)",
                    }}
                  />
                  <button type="submit" disabled={busy === "login" || loginUrl.trim().length === 0} style={button(busy !== "login" && loginUrl.trim().length > 0)}>
                    <LogIn size={12} aria-hidden="true" />{t("dispatch.login.open")}
                  </button>
                </form>

                {loginKept !== null && (
                  <div style={{ fontSize: 11, color: loginKept > 0 ? "var(--accent)" : "var(--status-error, #dc2626)" }}>
                    {loginKept > 0 ? t("dispatch.login.kept", { count: loginKept }) : t("dispatch.login.keptNone")}
                  </div>
                )}
                <div style={dim}>{t("dispatch.login.warning")}</div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
