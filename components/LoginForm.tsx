"use client";

import { LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n";

export function LoginForm() {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  const [next, setNext] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setError(params.get("error") === "1");
    setNext(params.get("next") ?? "");
  }, []);

  return (
    <main style={{ flex: 1, display: "grid", placeItems: "center", padding: "max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))", background: "var(--bg)", position: "relative" }}>
      <div style={{ position: "absolute", top: "max(16px, env(safe-area-inset-top))", right: "max(16px, env(safe-area-inset-right))", zIndex: 400 }}>
        <LanguageSwitcher />
      </div>
      <section
        className="login-form"
        aria-labelledby="login-title"
        style={{ width: "min(100%, 380px)", padding: "32px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", boxShadow: "var(--shadow-modal)" }}
      >
        <div style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--user-bg)", color: "var(--accent)", marginBottom: 20 }}>
          <LockKeyhole size={19} aria-hidden="true" />
        </div>
        <h1 id="login-title" className="display-serif" style={{ margin: 0, fontSize: 28, lineHeight: 1.1, color: "var(--text)" }}>{t("loginForm.title")}</h1>
        <p style={{ margin: "10px 0 24px", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>{t("loginForm.subtitle")}</p>
        <form method="post" action="/api/web-auth/session" style={{ display: "grid", gap: 14 }}>
          {next && <input type="hidden" name="next" value={next} />}
          <label htmlFor="web-password" style={{ display: "grid", gap: 6, color: "var(--text-muted)", fontSize: 12, fontWeight: 600 }}>
            {t("loginForm.password")}
            <input
              id="web-password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "password-error" : undefined}
              style={{ width: "100%", padding: "9px 10px", border: `1px solid ${error ? "var(--status-error)" : "var(--border)"}`, borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", fontSize: 14, outline: "none", boxShadow: "none" }}
            />
          </label>
          {error && <p id="password-error" role="alert" style={{ margin: 0, color: "var(--status-error)", fontSize: 12 }}>{t("loginForm.incorrect")}</p>}
          <button type="submit" style={{ minHeight: 36, border: 0, borderRadius: "var(--radius-control)", background: "var(--accent-strong)", color: "var(--on-accent)", fontWeight: 600, cursor: "pointer" }}>
            {t("loginForm.unlock")}
          </button>
        </form>
      </section>
    </main>
  );
}
