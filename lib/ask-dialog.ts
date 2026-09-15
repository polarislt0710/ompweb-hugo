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
