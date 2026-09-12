"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type FontPreset = "sans" | "serif" | "mono";

export interface FontPresetOption {
  id: FontPreset;
  name: string;
  fontFamily: string;
  description: string;
}

export const FONT_PRESETS: FontPresetOption[] = [
  {
    id: "sans",
    name: "Sans",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang TC', 'PingFang SC', 'Noto Sans TC', sans-serif",
    description: "Clean UI default",
  },
  {
    id: "serif",
    name: "Serif",
    fontFamily: "var(--font-serif), 'Songti SC', 'Source Serif 4', 'Noto Serif TC', Georgia, serif",
    description: "Bookish, warmer text",
  },
  {
    id: "mono",
    name: "Mono",
    fontFamily: "var(--font-mono), 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
    description: "Terminal / code look",
  },
];

export interface TypographyConfig {
  fontPreset: FontPreset;
}

const STORAGE_KEY = "omp-typography-config";
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const DEFAULT_CONFIG: TypographyConfig = { fontPreset: "sans" };

let cachedConfig: TypographyConfig = DEFAULT_CONFIG;
let hasInitialized = false;

function getClientSnapshot(): TypographyConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  if (!hasInitialized) {
    hasInitialized = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TypographyConfig>;
        cachedConfig = { fontPreset: parsed.fontPreset === "serif" || parsed.fontPreset === "mono" ? parsed.fontPreset : "sans" };
      }
    } catch {
      // Keep default typography when storage is unreadable.
    }
  }
  return cachedConfig;
}

function applyTypographyToDom(config: TypographyConfig) {
  if (typeof document === "undefined") return;
  const preset = FONT_PRESETS.find((item) => item.id === config.fontPreset) ?? FONT_PRESETS[0];
  document.documentElement.style.setProperty("--app-font-family", preset.fontFamily);
  document.documentElement.setAttribute("data-font-preset", config.fontPreset);
}

export function useTypography() {
  const config = useSyncExternalStore(subscribe, getClientSnapshot, () => DEFAULT_CONFIG);

  useEffect(() => {
    applyTypographyToDom(config);
  }, [config]);

  const setFontPreset = useCallback((preset: FontPreset) => {
    cachedConfig = { fontPreset: preset };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedConfig));
    } catch {
      // Typography remains usable without persistence.
    }
    applyTypographyToDom(cachedConfig);
    listeners.forEach((cb) => cb());
  }, []);

  return { fontPreset: config.fontPreset, setFontPreset };
}
