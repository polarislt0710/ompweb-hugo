"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";

export type Locale = "en" | "zh-TW" | "zh-CN" | "ja";

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: "zh-TW", label: "繁體" },
  { value: "zh-CN", label: "简体" },
  { value: "en", label: "EN" },
  { value: "ja", label: "日本語" },
];

const STORAGE_KEY = "omp-lang";

const dictionaries: Record<Locale, Record<string, string>> = {
  en: en as Record<string, string>,
  "zh-TW": zhTW as Record<string, string>,
  "zh-CN": zhCN as Record<string, string>,
  ja: ja as Record<string, string>,
};

const ZH_TW_MIGRATION_KEY = "omp-lang-zh-tw-default";

function isLocale(value: string | null): value is Locale {
  return value === "zh-TW" || value === "zh-CN" || value === "en" || value === "ja";
}

// Held on globalThis so a Fast Refresh module swap cannot split subscribers
// across two Sets — components mounted before the swap would otherwise never
// be notified of a language change.
interface I18nState {
  listeners: Set<() => void>;
  locale: Locale | null;
  hydrated: boolean;
}

declare global {
  var __ompI18nState: I18nState | undefined;
}

const state: I18nState = (globalThis.__ompI18nState ??= {
  listeners: new Set(),
  locale: null,
  hydrated: false,
});
const listeners = state.listeners;

function detectLocale(): Locale {
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      const migrated = localStorage.getItem(ZH_TW_MIGRATION_KEY) === "1";
      // Older builds mapped every zh browser to zh-CN. Move that default to
      // Taiwan Traditional once; an explicit later pick of 简体 still sticks.
      if (stored === "zh-CN" && !migrated) {
        localStorage.setItem(ZH_TW_MIGRATION_KEY, "1");
        localStorage.setItem(STORAGE_KEY, "zh-TW");
        return "zh-TW";
      }
      if (isLocale(stored)) {
        if (!migrated) localStorage.setItem(ZH_TW_MIGRATION_KEY, "1");
        return stored;
      }
    }
  } catch {
    // storage unavailable (private mode etc.)
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang === "zh-cn" || lang.startsWith("zh-hans") || lang.startsWith("zh-sg")) return "zh-CN";
    if (lang.startsWith("zh")) return "zh-TW";
    if (lang.startsWith("ja")) return "ja";
  }
  return "zh-TW";
}

function getLocale(): Locale {
  // During SSR or the initial hydration pass, return "en" to guarantee server/client HTML match
  if (typeof document === "undefined" || !state.hydrated) return "en";
  if (state.locale === null) state.locale = detectLocale();
  return state.locale;
}

export function setLocale(locale: Locale): void {
  state.hydrated = true;
  state.locale = locale;
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, locale);
    }
  } catch {
    // ignore storage errors
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  listeners.forEach((cb) => cb());
}

/** Translate outside React (toasts, error helpers). Falls back key → en → key. */
export function translate(key: string, vars?: Record<string, string | number>): string {
  const locale = getLocale();
  const template = dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Plural-aware translate: resolves `<key>.one` for count===1, `<key>.other`
 * otherwise (zh/ja dictionaries may map both to the same string). The count is
 * always available to the template as {count}. */
export function translatePlural(
  key: string,
  count: number,
  vars?: Record<string, string | number>,
): string {
  return translate(`${key}.${count === 1 ? "one" : "other"}`, { count, ...vars });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getServerSnapshot(): Locale {
  return "en";
}

/** Locale state + translator. Components re-render on language switch because
 * the locale is the subscribed snapshot. */
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getServerSnapshot);

  useEffect(() => {
    if (!state.hydrated) {
      state.hydrated = true;
      state.locale = detectLocale();
      if (typeof document !== "undefined") {
        document.documentElement.lang = state.locale;
      }
      listeners.forEach((cb) => cb());
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, vars),
    // translate() reads module state that only changes with `locale`; depending
    // on it keeps memoized consumers re-translating on switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const tn = useCallback(
    (key: string, count: number, vars?: Record<string, string | number>) =>
      translatePlural(key, count, vars),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return { locale, setLocale, t, tn };
}
