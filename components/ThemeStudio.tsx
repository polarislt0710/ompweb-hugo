"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Palette, Sparkles, Type, Waves } from "lucide-react";
import {
  THEME_OPTIONS,
  getCustomTheme,
  saveCustomTheme,
  useTheme,
  type CustomThemeConfig,
  type ThemePreference,
} from "@/hooks/useTheme";
import { useMotionPrefs } from "@/hooks/useMotionPrefs";
import { useTypography, FONT_PRESETS } from "@/hooks/useTypography";
import { useFontSize, type FontSizePreference } from "@/hooks/useFontSize";
import { useUiScale, type UiScalePreference } from "@/hooks/useUiScale";
import { useI18n } from "@/lib/i18n";

type StudioTab = "static" | "flowing" | "custom" | "motion" | "type";

const CUSTOM_PRESETS: Array<CustomThemeConfig & { name: string }> = [
  { name: "Cyber", accent: "#38BDF8", bg: "#0B0F19", isDark: true, mode: "flow" },
  { name: "Aurora", accent: "#34D399", bg: "#091410", isDark: true, mode: "flow" },
  { name: "Velvet", accent: "#BD93F9", bg: "#161020", isDark: true, mode: "flow" },
  { name: "Paper", accent: "#B03E22", bg: "#FAF9F6", isDark: false, mode: "static" },
];

function chip(active: boolean): CSSProperties {
  return {
    padding: "4px 0",
    fontSize: 10.5,
    fontWeight: 600,
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    background: active ? "var(--bg-selected)" : "transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
  };
}

export function ThemeStudio() {
  const { t } = useI18n();
  const { preference, setTheme } = useTheme();
  const { motionPrefs, setMotionPrefs } = useMotionPrefs();
  const { fontPreset, setFontPreset } = useTypography();
  const { fontSize, setFontSize } = useFontSize();
  const { uiScale, setUiScale } = useUiScale();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<StudioTab>("static");
  const [customConfig, setCustomConfig] = useState<CustomThemeConfig>(getCustomTheme);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = THEME_OPTIONS.find((option) => option.id === preference) ?? THEME_OPTIONS[0];
  const staticThemes = THEME_OPTIONS.filter((option) => option.category === "static" || option.category === "system");
  const flowingThemes = THEME_OPTIONS.filter((option) => option.category === "flowing");

  const pick = (id: ThemePreference, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTheme(id, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const changeCustom = (next: Partial<CustomThemeConfig>) => {
    const merged = { ...customConfig, ...next };
    setCustomConfig(merged);
    saveCustomTheme(merged);
    setTheme("custom");
  };

  return (
    <div ref={boxRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t("themeStudio.title")}
        aria-label={t("themeStudio.title")}
        aria-expanded={open}
        className="shell-toolbar-btn ui-focus-ring"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 6px", height: 28, borderRadius: 6 }}
      >
        <span style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: preference === "custom" ? customConfig.accent : current.accent,
          flexShrink: 0,
        }}
        />
        <Palette size={15} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
      </button>

      {open && (
        <div
          className="dropdown-surface animate-scale-in"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 650,
            width: 320,
            padding: 8,
            borderRadius: "var(--radius-card)",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-pop)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px 8px", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t("themeStudio.title")}</span>
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{preference}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2, padding: 2, borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", marginBottom: 8 }}>
            <button type="button" onClick={() => setTab("static")} style={chip(tab === "static")}>{t("themeStudio.tabStatic")}</button>
            <button type="button" onClick={() => setTab("flowing")} style={chip(tab === "flowing")}><Waves size={11} /></button>
            <button type="button" onClick={() => setTab("custom")} style={chip(tab === "custom")}>{t("themeStudio.tabCustom")}</button>
            <button type="button" onClick={() => setTab("motion")} style={chip(tab === "motion")}><Sparkles size={11} /></button>
            <button type="button" onClick={() => setTab("type")} style={chip(tab === "type")}><Type size={11} /></button>
          </div>

          {tab === "static" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 280, overflowY: "auto" }}>
              {staticThemes.map((option) => {
                const active = preference === option.id;
                return (
                  <button key={option.id} type="button" onClick={(event) => pick(option.id, event)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 8px", borderRadius: 6, fontSize: 12, border: "none", cursor: "pointer",
                    background: active ? "var(--bg-selected)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                  }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: option.color, boxShadow: `0 0 0 1.5px ${option.accent}` }} />
                      {option.name}
                    </span>
                    {active && <Check size={14} strokeWidth={2.2} style={{ color: "var(--accent)" }} />}
                  </button>
                );
              })}
            </div>
          )}

          {tab === "flowing" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {flowingThemes.map((option) => {
                const active = preference === option.id;
                return (
                  <button key={option.id} type="button" onClick={(event) => pick(option.id, event)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                    border: "1px solid var(--border)",
                    background: active ? "color-mix(in srgb, var(--accent) 14%, var(--bg))" : "var(--bg)",
                    color: active ? "var(--text)" : "var(--text-muted)",
                  }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 14, height: 14, borderRadius: "50%", background: option.accent, boxShadow: `0 0 8px ${option.accent}` }} />
                      {option.name}
                    </span>
                    {active && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          )}

          {tab === "custom" && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {CUSTOM_PRESETS.map((preset) => (
                  <button key={preset.name} type="button" onClick={() => changeCustom(preset)} style={{
                    padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)",
                    color: "var(--text)", fontSize: 11, cursor: "pointer", textAlign: "left",
                  }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
                {t("themeStudio.accent")}
                <input type="color" value={customConfig.accent} onChange={(event) => changeCustom({ accent: event.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
                {t("themeStudio.background")}
                <input type="color" value={customConfig.bg} onChange={(event) => changeCustom({ bg: event.target.value })} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <button type="button" onClick={() => changeCustom({ mode: "static" })} style={chip(customConfig.mode === "static")}>{t("themeStudio.static")}</button>
                <button type="button" onClick={() => changeCustom({ mode: "flow" })} style={chip(customConfig.mode === "flow")}>{t("themeStudio.flow")}</button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)" }}>
                <input type="checkbox" checked={customConfig.isDark} onChange={(event) => changeCustom({ isDark: event.target.checked })} />
                {t("themeStudio.darkSurfaces")}
              </label>
            </div>
          )}

          {tab === "motion" && (
            <div style={{ display: "grid", gap: 8, fontSize: 12, color: "var(--text)" }}>
              <label style={{ display: "flex", gap: 8 }}>
                <input type="checkbox" checked={motionPrefs.enabled} onChange={(event) => setMotionPrefs({ enabled: event.target.checked })} />
                {t("themeStudio.motionOn")}
              </label>
              <label style={{ display: "flex", gap: 8 }}>
                <input type="checkbox" checked={motionPrefs.chatBorderBeam} onChange={(event) => setMotionPrefs({ chatBorderBeam: event.target.checked })} />
                {t("themeStudio.chatBorderBeam")}
              </label>
              <label style={{ display: "flex", gap: 8 }}>
                <input type="checkbox" checked={motionPrefs.thinkingPulse} onChange={(event) => setMotionPrefs({ thinkingPulse: event.target.checked })} />
                {t("themeStudio.thinkingPulse")}
              </label>
            </div>
          )}

          {tab === "type" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 4 }}>
                {FONT_PRESETS.map((preset) => {
                  const nameKey = preset.id === "serif"
                    ? "themeStudio.fontSerif"
                    : preset.id === "mono"
                      ? "themeStudio.fontMono"
                      : "themeStudio.fontSans";
                  const descKey = preset.id === "serif"
                    ? "themeStudio.fontSerifDesc"
                    : preset.id === "mono"
                      ? "themeStudio.fontMonoDesc"
                      : "themeStudio.fontSansDesc";
                  return (
                  <button key={preset.id} type="button" onClick={() => setFontPreset(preset.id)} style={{
                    ...chip(fontPreset === preset.id),
                    textAlign: "left",
                    padding: "6px 8px",
                  }}
                  >
                    {t(nameKey)} — {t(descKey)}
                  </button>
                  );
                })}
              </div>
              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "grid", gap: 4 }}>
                {t("themeStudio.chatSize")}
                <select value={fontSize} onChange={(event) => setFontSize(event.target.value as FontSizePreference)} style={{ fontSize: 12 }}>
                  <option value="sm">{t("themeStudio.sizeSmall")}</option>
                  <option value="md">{t("themeStudio.sizeMedium")}</option>
                  <option value="lg">{t("themeStudio.sizeLarge")}</option>
                  <option value="xl">{t("themeStudio.sizeXl")}</option>
                </select>
              </label>
              <label style={{ fontSize: 11, color: "var(--text-muted)", display: "grid", gap: 4 }}>
                {t("themeStudio.interfaceScale")}
                <select value={uiScale} onChange={(event) => setUiScale(event.target.value as UiScalePreference)} style={{ fontSize: 12 }}>
                  <option value="compact">{t("themeStudio.scaleCompact")}</option>
                  <option value="standard">{t("themeStudio.scaleStandard")}</option>
                  <option value="comfortable">{t("themeStudio.scaleComfortable")}</option>
                  <option value="large">{t("themeStudio.scaleLarge")}</option>
                </select>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
