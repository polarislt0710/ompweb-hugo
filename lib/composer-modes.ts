export const COMPOSER_MODES = ["off", "plan", "flow", "grill", "ask-matt"] as const;
export type ComposerMode = (typeof COMPOSER_MODES)[number];

export const COMPOSER_MODE_COMMAND: Record<Exclude<ComposerMode, "off">, string> = {
  plan: "plan",
  flow: "flow",
  grill: "grill",
  "ask-matt": "ask-matt",
};

const MODE_SET = new Set<string>(COMPOSER_MODES);

export function isComposerMode(value: string | null | undefined): value is ComposerMode {
  return typeof value === "string" && MODE_SET.has(value);
}

export function composerModeStorageKey(draftKey: string): string {
  return `omp-composer-mode:${draftKey}`;
}

/** Migrate the old Plan-only flag, then read the current composer mode. */
export function readComposerMode(draftKey: string | undefined): ComposerMode {
  if (!draftKey || typeof window === "undefined") return "off";
  try {
    const stored = window.sessionStorage.getItem(composerModeStorageKey(draftKey));
    if (isComposerMode(stored)) return stored;
    if (window.sessionStorage.getItem(`omp-plan-mode:${draftKey}`) === "1") return "plan";
  } catch {
    // private mode
  }
  return "off";
}

export function writeComposerMode(draftKey: string | undefined, mode: ComposerMode): void {
  if (!draftKey || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(composerModeStorageKey(draftKey), mode);
    window.sessionStorage.setItem(`omp-plan-mode:${draftKey}`, mode === "plan" ? "1" : "0");
  } catch {
    // private mode
  }
}

export function toggleComposerMode(current: ComposerMode, next: Exclude<ComposerMode, "off">): ComposerMode {
  return current === next ? "off" : next;
}

export function composerModeSlashLine(mode: ComposerMode, message: string): string | null {
  if (mode === "off") return null;
  const command = COMPOSER_MODE_COMMAND[mode];
  return `/${command} ${message}`.trimEnd();
}
