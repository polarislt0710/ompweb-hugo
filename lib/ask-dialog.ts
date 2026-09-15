import type {
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionAskDialogResultItem,
} from "./types";

export type AskSelections = Record<string, number[]>;
export type AskCustomAnswers = Record<string, string>;

const OTHER_LABEL_RE = /^(other(\s*\(.*\))?|something else|custom|其它|其他(答案)?(\s*[（(].*[）)])?|その他)$/i;
const MULTI_HINT_RE = /(select all|all that apply|pick any|choose any|as many as|one or more|multi-?select|可多選|可以多選|可選多個|可揀多個|揀多過一個|多項選擇|全選適用|複数選|いくつでも)/i;

/** True when a model-supplied option is the reserved Other control, not a real choice. */
export function isOtherOptionLabel(label: string): boolean {
  return OTHER_LABEL_RE.test(label.trim().replace(/\s+/g, " "));
}

export function coerceAskMultiFlag(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return undefined;
}

/**
 * Multi-select when the ask payload says so, or when the prompt clearly asks
 * for more than one choice but omitted `multi`.
 */
export function isAskMulti(question: { multi?: unknown; question?: string; header?: string }): boolean {
  const flagged = coerceAskMultiFlag(question.multi);
  if (flagged !== undefined) return flagged;
  return MULTI_HINT_RE.test(`${question.question ?? ""} ${question.header ?? ""}`);
}

export function encodeAskSubmit(
  questions: ExtensionAskDialogQuestion[],
  selectedById: AskSelections,
  customById: AskCustomAnswers,
): string {
  const results: ExtensionAskDialogResultItem[] = questions.map((question) => {
    const customInput = customById[question.id]?.trim();
    return {
      id: question.id,
      question: question.question,
      options: question.options.map((option) => option.label),
      multi: isAskMulti(question),
      selectedOptions: (selectedById[question.id] ?? [])
        .map((index) => question.options[index]?.label)
        .filter((label): label is string => typeof label === "string"),
      ...(customInput ? { customInput } : {}),
    };
  });
  const payload: ExtensionAskDialogResult = { kind: "submit", results };
  return JSON.stringify(payload);
}

export function questionHasAnswer(
  question: ExtensionAskDialogQuestion,
  selectedById: AskSelections,
  customById: AskCustomAnswers,
): boolean {
  const selected = selectedById[question.id] ?? [];
  const custom = customById[question.id]?.trim() ?? "";
  return selected.length > 0 || custom.length > 0;
}

/** omp rpc-ui has no askDialog, so Ask falls back to select + editor. */
export const ASK_SELECT_OTHER = "Other (type your own)";
const SELECTED_COUNT_RE = /^\((\d+) selected\)\s*/i;
const DONE_SELECTING_RE = /done selecting/i;
const RECOMMENDED_SUFFIX = " (Recommended)";

export function isAskSelectOtherLabel(label: string): boolean {
  const normalized = label.trim().replace(/\s+/g, " ");
  return normalized === ASK_SELECT_OTHER || isOtherOptionLabel(normalized);
}

export function isAskSelectDoneLabel(label: string): boolean {
  return DONE_SELECTING_RE.test(label);
}

export function parseAskSelectTitle(title: string): { question: string; selectedCount: number } {
  const match = SELECTED_COUNT_RE.exec(title);
  if (!match) return { question: title, selectedCount: 0 };
  return {
    question: title.slice(match[0].length),
    selectedCount: Number(match[1]),
  };
}

export function isAskSelectMulti(title: string, options: readonly string[]): boolean {
  if (options.some(isAskSelectDoneLabel)) return true;
  if (parseAskSelectTitle(title).selectedCount > 0) return true;
  return isAskMulti({ question: parseAskSelectTitle(title).question });
}

export function stripAskRecommendedSuffix(label: string): { label: string; recommended: boolean } {
  if (label.endsWith(RECOMMENDED_SUFFIX)) {
    return { label: label.slice(0, -RECOMMENDED_SUFFIX.length), recommended: true };
  }
  return { label, recommended: false };
}

let stashedAskCustom: { text: string; at: number } | null = null;

export function stashAskSelectCustom(text: string): void {
  const trimmed = text.trim();
  stashedAskCustom = trimmed ? { text: trimmed, at: Date.now() } : null;
}

export function takeAskSelectCustom(maxAgeMs = 8_000): string | null {
  const pending = stashedAskCustom;
  stashedAskCustom = null;
  if (!pending) return null;
  if (Date.now() - pending.at > maxAgeMs) return null;
  return pending.text;
}

export function mentionableAskLabels(labels: readonly string[]): string[] {
  return labels.filter((label) => !isAskSelectOtherLabel(label) && !isAskSelectDoneLabel(label) && !isOtherOptionLabel(label));
}

const checkedByQuestion = new Map<string, Set<string>>();

export function readAskChecked(question: string): Set<string> {
  return new Set(checkedByQuestion.get(question) ?? []);
}

export function writeAskChecked(question: string, checked: Iterable<string>): void {
  checkedByQuestion.set(question, new Set(checked));
}

/** Build the Other-box payload for a multi pick so omp receives every choice in one answer. */
export function composeAskMultiCustom(
  checkedLabels: readonly string[],
  allLabels: readonly string[],
  notes: string,
): string {
  const mentionable = mentionableAskLabels(allLabels);
  const selected = mentionable.flatMap((label, index) => {
    if (!checkedLabels.includes(label)) return [];
    return [`「${index + 1}. ${stripAskRecommendedSuffix(label).label}」`];
  });
  const extra = expandAskOptionMentions(notes.trim(), mentionable);
  return [...selected, extra].filter(Boolean).join("\n");
}

const AT_TOKEN_RE = /@\s*(\d+)\b/g;

/** Replace `@1` / `@ 2` with the numbered option text before sending to omp. */
export function expandAskOptionMentions(text: string, labels: readonly string[]): string {
  return text.replace(AT_TOKEN_RE, (match, raw) => {
    const index = Number(raw) - 1;
    const label = labels[index];
    if (!label) return match;
    return `「${raw}. ${stripAskRecommendedSuffix(label).label}」`;
  });
}

/** `@` token at the caret for the option mention menu. */
export function matchAskAtToken(text: string, caret: number): { start: number; query: string } | null {
  const head = text.slice(0, Math.max(0, caret));
  const at = head.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && /[\w]/.test(head[at - 1] ?? "")) return null;
  const query = head.slice(at + 1);
  if (query.includes("\n") || query.length > 24) return null;
  return { start: at, query };
}
