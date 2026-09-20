import { formatCompactNumber } from "@/lib/format";

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

/** Legacy preference: an allowlist of the models the composer may show. */
export const COMPOSER_MODELS_STORAGE_KEY = "omp-composer-models";
/** Current preference: the models the composer must hide. */
export const COMPOSER_HIDDEN_MODELS_STORAGE_KEY = "omp-composer-hidden-models";
export const COMPOSER_MODELS_CHANGE_EVENT = "omp-composer-models-change";

function readKeySet(storageKey: string): Set<string> | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return Array.isArray(value) ? new Set(value.filter((item): item is string => typeof item === "string")) : null;
  } catch {
    return null;
  }
}

export function readHiddenModelKeys(): Set<string> {
  return readKeySet(COMPOSER_HIDDEN_MODELS_STORAGE_KEY) ?? new Set();
}

export function writeHiddenModelKeys(hidden: Set<string>): void {
  try {
    localStorage.setItem(COMPOSER_HIDDEN_MODELS_STORAGE_KEY, JSON.stringify([...hidden]));
    window.dispatchEvent(new Event(COMPOSER_MODELS_CHANGE_EVENT));
  } catch {
    // Storage is optional UI state; a disabled or full store must not break the composer.
  }
}

/**
 * The preference used to be an allowlist, so every model omp gained afterwards
 * — a newly connected provider, a new GLM or DeepSeek release — stayed hidden
 * from the composer with nothing in the UI saying why. Rewrite the allowlist
 * into the equivalent hide-list once the full runtime model list is known, so
 * the existing choices survive and anything new is visible by default.
 *
 * Returns the resulting hide-list when it migrated, otherwise null.
 */
export function migrateVisibleModelKeys(allModelKeys: string[]): Set<string> | null {
  if (allModelKeys.length === 0) return null;
  const legacy = readKeySet(COMPOSER_MODELS_STORAGE_KEY);
  if (legacy === null) return null;
  const hidden = readHiddenModelKeys();
  for (const key of allModelKeys) {
    if (!legacy.has(key)) hidden.add(key);
  }
  try {
    localStorage.removeItem(COMPOSER_MODELS_STORAGE_KEY);
  } catch {
    // Leaving the legacy key behind only costs one more migration pass.
  }
  writeHiddenModelKeys(hidden);
  return hidden;
}

export function compareModelOptions(collator: Intl.Collator, a: ModelOption, b: ModelOption): number {
  return collator.compare(a.name || a.modelId, b.name || b.modelId)
    || collator.compare(a.provider, b.provider)
    || collator.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelOption[], query: string, locale: string): ModelOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  if (!normalizedQuery) return options;
  return options.filter((option) => (
    option.name.toLocaleLowerCase(locale).includes(normalizedQuery)
    || option.modelId.toLocaleLowerCase(locale).includes(normalizedQuery)
    || option.provider.toLocaleLowerCase(locale).includes(normalizedQuery)
  ));
}

export function formatTokenCount(tokens: number, locale: string): string {
  return formatCompactNumber(tokens, locale);
}
