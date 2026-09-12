export type OutputStyleId =
  | "default"
  | "adhd"
  | "eli5"
  | "eli15"
  | "ladder"
  | "concise"
  | "caveman"
  | "explanatory";

export interface OutputStyle {
  id: OutputStyleId;
  labelKey: string;
  descriptionKey: string;
  /** Empty = no extra prompt. AGENTS.md still applies. */
  prompt: string;
}

export const OUTPUT_STYLE_STORAGE_KEY = "omp-output-style";

/**
 * Compact, checkable voices. Sources: Claude Code built-ins, smixs/awesome-claude-output-styles
 * (ELI15, Ladder, ADHD, Caveman), r/explainlikeimfive.
 */
export const OUTPUT_STYLES: readonly OutputStyle[] = [
  {
    id: "default",
    labelKey: "chatInput.styleDefault",
    descriptionKey: "chatInput.styleDefaultHint",
    prompt: "",
  },
  {
    id: "adhd",
    labelKey: "chatInput.styleAdhd",
    descriptionKey: "chatInput.styleAdhdHint",
    prompt: `ADHD style: first line is the next action. Numbered steps. Lists ≤5. One line of where we are. Time in minutes. No preamble or closer. Depth request ("explain properly") drops the length cap.`,
  },
  {
    id: "eli5",
    labelKey: "chatInput.styleEli5",
    descriptionKey: "chatInput.styleEli5Hint",
    prompt: `Explain like the reader is 5: 2–3 short sentences, one everyday picture (toys, snacks, playground), no jargon in the prose. Then one sentence of what to do. Code, commands, paths, and numbers stay exact. Depth request: still simple words, but include every number and condition.`,
  },
  {
    id: "eli15",
    labelKey: "chatInput.styleEli15",
    descriptionKey: "chatInput.styleEli15Hint",
    prompt: `ELI15: explain to a smart 15-year-old. Answer first. Main explanation ≤150 words. Exactly one analogy from one everyday domain, then say where the comparison breaks. Define jargon in the same sentence. End with one line they could repeat tomorrow. Never say "just" or "simply". Depth request: drop the word cap, keep one analogy.`,
  },
  {
    id: "ladder",
    labelKey: "chatInput.styleLadder",
    descriptionKey: "chatInput.styleLadderHint",
    prompt: `Ladder: three labeled rungs — Like I'm 5 (no jargon, one picture); Like I'm 15 (real mechanism, terms defined on the spot); Like a pro (precise, trade-offs, what you'd do). Keep the three rungs together shorter than one long answer. Trivial lookups get one rung. Artefacts (commit message, email, snippet) ship bare, no rungs.`,
  },
  {
    id: "concise",
    labelKey: "chatInput.styleConcise",
    descriptionKey: "chatInput.styleConciseHint",
    prompt: `Concise: lead with the result. Skip preamble and narration. Keep replies short by default. When asked to explain, answer in full. Error reports, security warnings, and destructive-action confirmations stay complete.`,
  },
  {
    id: "caveman",
    labelKey: "chatInput.styleCaveman",
    descriptionKey: "chatInput.styleCavemanHint",
    prompt: `Caveman: lead with answer, then reason, then next step. Drop articles, hedging, preamble. Fragments OK. Technical terms stay precise. No invented abbreviations. Artefacts use normal full language. Security and destructive confirmations use full sentences.`,
  },
  {
    id: "explanatory",
    labelKey: "chatInput.styleExplanatory",
    descriptionKey: "chatInput.styleExplanatoryHint",
    prompt: `Explanatory: do the engineering work, and add short Insights on why a choice was made or how a pattern in this repo works. Insights are optional asides, not a lecture. Skip them on tiny mechanical edits.`,
  },
];

const STYLE_BY_ID = new Map(OUTPUT_STYLES.map((style) => [style.id, style]));

export function isOutputStyleId(value: string | null | undefined): value is OutputStyleId {
  return typeof value === "string" && STYLE_BY_ID.has(value as OutputStyleId);
}

export function getOutputStyle(id: string | null | undefined): OutputStyle {
  if (isOutputStyleId(id)) return STYLE_BY_ID.get(id)!;
  return OUTPUT_STYLES[0];
}

export function readOutputStyleId(): OutputStyleId {
  if (typeof window === "undefined") return "default";
  try {
    const stored = window.localStorage.getItem(OUTPUT_STYLE_STORAGE_KEY);
    if (isOutputStyleId(stored)) return stored;
  } catch {
    // private mode
  }
  return "default";
}

export function writeOutputStyleId(id: OutputStyleId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OUTPUT_STYLE_STORAGE_KEY, id);
  } catch {
    // private mode
  }
}

export function applyOutputStyle(styleId: string | null | undefined, message: string): string {
  const style = getOutputStyle(styleId);
  if (!style.prompt) return message;
  return `<output-style name="${style.id}">\n${style.prompt}\n</output-style>\n\n${message}`;
}

const OUTPUT_STYLE_BLOCK = /^<output-style\b[^>]*>[\s\S]*?<\/output-style>(?:\r?\n)*/i;

/** Remove the hidden style wrapper so chat bubbles, copy, and titles show only the user's words. */
export function stripOutputStyle(message: string): string {
  return message.replace(OUTPUT_STYLE_BLOCK, "").replace(/^\uFEFF/, "");
}

export function applyStoredOutputStyle(message: string): string {
  return applyOutputStyle(readOutputStyleId(), message);
}
