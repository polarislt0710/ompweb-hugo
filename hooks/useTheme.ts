"use client";

import { createElement, useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type LightTheme =
  | "light"
  | "one-light"
  | "catppuccin-latte"
  | "rose-pine-dawn"
  | "oatmeal"
  | "matcha"
  | "sepia";
export type DarkTheme =
  | "dark"
  | "omp"
  | "dracula"
  | "harbor"
  | "one-dark-pro"
  | "rose-pine"
  | "catppuccin-mocha"
  | "gruvbox-dark"
  | "nord"
  | "tokyo-night"
  | "oled"
  | "pine"
  | "navy"
  | "codex"
  | "aurora-flow"
  | "dawn-flow"
  | "cosmic-flow"
  | "ocean-flow"
  | "sakura-flow"
  | "bamboo-flow";

export type Theme = LightTheme | DarkTheme;
export type ThemePreference = Theme | "system" | "custom";

export type ThemeDefinition = {
  id: Theme;
  name: string;
  mode: "light" | "dark";
  bg: string;
  accent: string;
  category?: "static" | "flowing";
};

export interface CustomThemeConfig {
  accent: string;
  bg: string;
  panel?: string;
  text?: string;
  ompO?: string;
  ompM?: string;
  ompP?: string;
  mode: "static" | "flow";
  isDark: boolean;
}

export interface ThemeOption {
  id: ThemePreference;
  name: string;
  isDark: boolean;
  color: string;
  accent: string;
  category: "static" | "flowing" | "system" | "custom";
}

export const LIGHT_THEMES: ReadonlyArray<ThemeDefinition> = [
  { id: "light", name: "Warm paper", mode: "light", bg: "#FAF9F6", accent: "#B03E22", category: "static" },
  { id: "one-light", name: "One Light", mode: "light", bg: "#FAFAFA", accent: "#2F65D9", category: "static" },
  { id: "catppuccin-latte", name: "Catppuccin Latte", mode: "light", bg: "#EFF1F5", accent: "#1E66F5", category: "static" },
  { id: "rose-pine-dawn", name: "Rosé Pine Dawn", mode: "light", bg: "#FAF4ED", accent: "#286983", category: "static" },
  { id: "oatmeal", name: "Oatmeal latte", mode: "light", bg: "#F7F4EE", accent: "#965A38", category: "static" },
  { id: "matcha", name: "Kyoto matcha", mode: "light", bg: "#F3F6F3", accent: "#2D6A4F", category: "static" },
  { id: "sepia", name: "Antique vellum", mode: "light", bg: "#F5EEDC", accent: "#8C4820", category: "static" },
];

export const DARK_THEMES: ReadonlyArray<ThemeDefinition> = [
  { id: "omp", name: "OMP Midnight", mode: "dark", bg: "#000000", accent: "#EC5BAB", category: "static" },
  { id: "dark", name: "Warm ember", mode: "dark", bg: "#1B1916", accent: "#E07B54", category: "static" },
  { id: "dracula", name: "Dracula", mode: "dark", bg: "#282A36", accent: "#FF79C6", category: "static" },
  { id: "harbor", name: "Harbor", mode: "dark", bg: "#1B1B1B", accent: "#E75A50", category: "static" },
  { id: "one-dark-pro", name: "One Dark Pro", mode: "dark", bg: "#282C34", accent: "#61AFEF", category: "static" },
  { id: "rose-pine", name: "Rosé Pine", mode: "dark", bg: "#191724", accent: "#EBBCBA", category: "static" },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", mode: "dark", bg: "#1E1E2E", accent: "#CBA6F7", category: "static" },
  { id: "gruvbox-dark", name: "Gruvbox Dark", mode: "dark", bg: "#282828", accent: "#FE8019", category: "static" },
  { id: "nord", name: "Nord", mode: "dark", bg: "#2E3440", accent: "#88C0D0", category: "static" },
  { id: "tokyo-night", name: "Tokyo Night", mode: "dark", bg: "#1A1B26", accent: "#7AA2F7", category: "static" },
  { id: "oled", name: "OLED obsidian", mode: "dark", bg: "#000000", accent: "#38BDF8", category: "static" },
  { id: "codex", name: "Codex mono", mode: "dark", bg: "#000000", accent: "#FFFFFF", category: "static" },
  { id: "pine", name: "Pine forest", mode: "dark", bg: "#121B17", accent: "#52B788", category: "static" },
  { id: "navy", name: "Horizon navy", mode: "dark", bg: "#0F172A", accent: "#60A5FA", category: "static" },
  { id: "aurora-flow", name: "Aurora", mode: "dark", bg: "#0c1417", accent: "#34d399", category: "flowing" },
  { id: "dawn-flow", name: "Dawn glow", mode: "dark", bg: "#16101a", accent: "#f472b6", category: "flowing" },
  { id: "cosmic-flow", name: "Cosmic nebula", mode: "dark", bg: "#090b16", accent: "#818cf8", category: "flowing" },
  { id: "ocean-flow", name: "Ocean glow", mode: "dark", bg: "#071318", accent: "#38bdf8", category: "flowing" },
  { id: "sakura-flow", name: "Sakura dusk", mode: "dark", bg: "#171114", accent: "#fb7185", category: "flowing" },
  { id: "bamboo-flow", name: "Bamboo mist", mode: "dark", bg: "#0c1612", accent: "#10b981", category: "flowing" },
];

export const ALL_THEMES: ReadonlyArray<ThemeDefinition> = [...LIGHT_THEMES, ...DARK_THEMES];
const LIGHT_THEME_IDS = new Set<Theme>(LIGHT_THEMES.map((theme) => theme.id));
const THEME_BY_ID = new Map(ALL_THEMES.map((theme) => [theme.id, theme]));

export const THEME_OPTIONS: ThemeOption[] = [
  ...ALL_THEMES.map((theme) => ({
    id: theme.id,
    name: theme.name,
    isDark: theme.mode === "dark",
    color: theme.bg,
    accent: theme.accent,
    category: theme.category === "flowing" ? "flowing" as const : "static" as const,
  })),
  { id: "system", name: "System", isDark: false, color: "#777777", accent: "#B03E22", category: "system" },
  { id: "custom", name: "Custom", isDark: true, color: "#0B0F19", accent: "#38BDF8", category: "custom" },
];

export function isDarkTheme(theme: Theme): boolean {
  return !LIGHT_THEME_IDS.has(theme);
}

const VALID_PREFERENCES: Record<string, true> = Object.fromEntries([
  ...ALL_THEMES.map((theme) => [theme.id, true] as const),
  ["system", true],
  ["custom", true],
]);

const STORAGE_KEY = "omp-theme";
const CUSTOM_STORAGE_KEY = "omp-custom-theme";
const listeners = new Set<() => void>();

let cachedCustomTheme: CustomThemeConfig = {
  accent: "#38BDF8",
  bg: "#0B0F19",
  mode: "flow",
  isDark: true,
};
let customThemeInitialized = false;

export function getCustomTheme(): CustomThemeConfig {
  if (typeof window === "undefined") return cachedCustomTheme;
  if (!customThemeInitialized) {
    customThemeInitialized = true;
    try {
      const saved = localStorage.getItem(CUSTOM_STORAGE_KEY);
      if (saved) cachedCustomTheme = { ...cachedCustomTheme, ...JSON.parse(saved) };
    } catch {
      // Keep the in-memory default when storage is unavailable.
    }
  }
  return cachedCustomTheme;
}

export function saveCustomTheme(config: CustomThemeConfig): void {
  cachedCustomTheme = config;
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Theme remains usable without persistence.
  }
  if (typeof document !== "undefined") applyCustomStyles(config);
  listeners.forEach((cb) => cb());
}

function clearFlowBackground(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove("theme-flow-active");
  const bodyStyle = document.body?.style;
  if (!bodyStyle) return;
  bodyStyle.background = "";
  bodyStyle.backgroundSize = "";
  bodyStyle.animation = "";
}

function applyFlowBackground(bg: string, accent: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add("theme-flow-active");
  const bodyStyle = document.body?.style;
  if (!bodyStyle) return;
  bodyStyle.background = `linear-gradient(-45deg, ${bg}, color-mix(in srgb, ${accent} 25%, ${bg}), ${bg})`;
  bodyStyle.backgroundSize = "400% 400%";
  bodyStyle.animation = "omp-mesh-flow 18s ease infinite";
}

function applyCustomStyles(config: CustomThemeConfig): void {
  const root = document.documentElement;
  root.style.setProperty("--accent", config.accent);
  root.style.setProperty("--accent-strong", config.accent);
  root.style.setProperty("--accent-hover", config.accent);
  root.style.setProperty("--bg", config.bg);
  root.style.setProperty("--bg-panel", config.panel || (config.isDark ? "color-mix(in srgb, var(--bg) 82%, white 4%)" : "color-mix(in srgb, var(--bg) 86%, black 3%)"));
  root.style.setProperty("--border", config.isDark ? "color-mix(in srgb, var(--bg) 76%, white 12%)" : "color-mix(in srgb, var(--bg) 76%, black 10%)");
  root.style.setProperty("--text", config.text || (config.isDark ? "#EBE6DC" : "#2B2823"));
  root.style.setProperty("--text-muted", config.isDark ? "#A39B8E" : "#69635A");
  root.style.setProperty("--omp-o", config.ompO || config.accent);
  root.style.setProperty("--omp-m", config.ompM || `color-mix(in srgb, ${config.accent} 65%, #F59E0B)`);
  root.style.setProperty("--omp-p", config.ompP || `color-mix(in srgb, ${config.accent} 65%, #38BDF8)`);
  root.classList.toggle("dark", config.isDark);
  root.classList.toggle("omp", false);
  root.setAttribute("data-theme", "custom");
  root.setAttribute("data-custom-mode", config.mode);
  if (config.mode === "flow") applyFlowBackground(config.bg, config.accent);
  else clearFlowBackground();
}

function clearCustomStyles(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of ["--accent", "--accent-strong", "--accent-hover", "--bg", "--bg-panel", "--border", "--text", "--text-muted", "--omp-o", "--omp-m", "--omp-p"]) {
    root.style?.removeProperty?.(name);
  }
  root.removeAttribute?.("data-custom-mode");
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function storedPreference(): ThemePreference {
  if (typeof window === "undefined") return "omp";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && VALID_PREFERENCES[value]) {
      return value as ThemePreference;
    }
    return "omp";
  } catch {
    return "omp";
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark = false): Theme {
  if (preference === "custom") return getCustomTheme().isDark ? "dark" : "light";
  if (preference === "omp") return "omp";
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === "light") return "dark";
  if (preference === "dark") return "omp";
  if (preference === "omp") return "system";
  if (preference === "system") return "light";
  return isDarkTheme(preference as Theme) ? "light" : "dark";
}

export function ThemeColor() {
  // React matches hoisted metadata by content during hydration. Adopt the
  // pre-paint value so it reuses this node instead of adding a fallback copy.
  const color = typeof document === "undefined"
    ? null
    : document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
  return createElement("meta", { name: "theme-color", content: color || "#000000" });
}

export function applyDomTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  clearCustomStyles();
  const dark = isDarkTheme(theme);
  const cl = document.documentElement.classList;
  const toRemove: string[] = [];
  cl.forEach((cls) => {
    if (cls.startsWith("theme-")) toRemove.push(cls);
  });
  toRemove.forEach((cls) => cl.remove(cls));

  cl.toggle("dark", dark && theme !== "omp");
  cl.toggle("omp", theme === "omp");
  if (theme !== "omp") {
    cl.add(`theme-${theme}`);
  }
  document.documentElement.setAttribute("data-theme", theme);
  const themeDef = THEME_BY_ID.get(theme);
  if (themeDef?.category === "flowing") applyFlowBackground(themeDef.bg, themeDef.accent);
  else clearFlowBackground();
  const color = themeDef?.bg ?? ALL_THEMES.find((definition) => definition.id === theme)?.bg;
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta && color) themeColorMeta.setAttribute("content", color);
}

function applyTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Theme selection remains usable when storage is unavailable.
  }
  if (preference === "custom") {
    applyCustomStyles(getCustomTheme());
    listeners.forEach((cb) => cb());
    return;
  }
  const theme = resolveTheme(preference, window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  applyDomTheme(theme);
  listeners.forEach((cb) => cb());
}

function getServerSnapshot(): ThemePreference {
  return "omp";
}

type ToggleOrigin = { x: number; y: number };
function motionDurationMs(variable: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (raw.endsWith("ms")) {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }
  if (raw.endsWith("s")) {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value * 1000 : fallback;
  }
  return fallback;
}


export function useTheme() {
  const preference = useSyncExternalStore(subscribe, storedPreference, getServerSnapshot);
  // The OS preference is browser-only. Deferring it until after hydration keeps
  // the initial client tree identical to the server's omp snapshot.
  const [hydrated, setHydrated] = useState(false);
  const [osDark, setOsDark] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  // Track the OS color scheme in state so an OS light/dark flip changes the
  // snapshot and re-renders isDark consumers, even when the stored preference
  // itself ("system") is unchanged. Registered unconditionally at subscription
  // time: consumers on an explicit light/dark preference still keep osDark
  // fresh for when they switch back to system.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setOsDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const prefersDark = hydrated && osDark;
  const theme = resolveTheme(preference, prefersDark);
  // Heal the DOM class on mount: stored preferences can predate the current
  // default, and pre-paint only runs on full page loads —
  // without this, hot-reloaded windows keep stale classes until restarted.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (preference === "custom") {
      applyCustomStyles(getCustomTheme());
      return;
    }
    const current = resolveTheme(preference, window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    applyDomTheme(current);
  }, [preference]);

  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = resolveTheme("system", media.matches);
      applyDomTheme(current);
    };
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference, origin?: ToggleOrigin) => {
    const apply = () => applyTheme(next);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";
    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(apply);
    transition.ready.then(() => {
      const styles = getComputedStyle(document.documentElement);
      document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] }, {
        duration: motionDurationMs("--dur-theme", 450),
        easing: styles.getPropertyValue("--ease-out-warm").trim() || "ease-out",
        pseudoElement: "::view-transition-new(root)",
      });
    }).catch(() => {});
    transition.finished?.catch(() => {});
  }, []);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => setTheme(nextThemePreference(preference), origin), [preference, setTheme]);

  const isDark = preference === "custom" ? getCustomTheme().isDark : isDarkTheme(theme);
  return { theme, preference, isDark, setTheme, toggleTheme };
}
