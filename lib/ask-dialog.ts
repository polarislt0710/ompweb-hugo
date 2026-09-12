import type {
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionAskDialogResultItem,
} from "./types";

export type AskSelections = Record<string, number[]>;
export type AskCustomAnswers = Record<string, string>;

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
      multi: question.multi ?? false,
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
