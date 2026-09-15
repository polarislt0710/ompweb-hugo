/**
 * Inline skill tags stored in the composer value as `{{skill:name}}`.
 * The field renders those tokens as chips; send-time composition expands them.
 */

import { getWebSlashCommand } from "./web-slash-commands";

const USE_ACTIVE_LINE_RE = /^use active skills:\s*(.*)$/i;

export const SKILL_TOKEN_RE = /\{\{skill:([^}\n]+)\}\}/g;

export type PromptSegment =
  | { type: "text"; value: string }
  | { type: "skill"; name: string };

export function skillToken(name: string): string {
  return `{{skill:${name}}}`;
}

export function parsePromptSegments(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const re = new RegExp(SKILL_TOKEN_RE.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) segments.push({ type: "text", value: text.slice(last, match.index) });
    const name = match[1]?.trim();
    if (name) segments.push({ type: "skill", name });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

export function inlineSkillNames(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const segment of parsePromptSegments(text)) {
    if (segment.type !== "skill") continue;
    const key = segment.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(segment.name);
  }
  return names;
}

export function stripSkillTokens(text: string): string {
  return text.replace(new RegExp(SKILL_TOKEN_RE.source, "g"), " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/ {2,}/g, " ");
}

export function mentionsSkillToken(text: string, skillName: string): boolean {
  const key = skillName.toLowerCase();
  return inlineSkillNames(text).some((name) => name.toLowerCase() === key);
}

export function insertSkillToken(text: string, skillName: string, cursor = text.length): { text: string; cursor: number } {
  if (mentionsSkillToken(text, skillName)) {
    return { text, cursor: Math.min(Math.max(0, cursor), text.length) };
  }
  const at = Math.min(Math.max(0, cursor), text.length);
  const token = skillToken(skillName);
  const before = text.slice(0, at);
  const after = text.slice(at);
  const leftPad = before.length > 0 && !/[\s\n]$/.test(before) ? " " : "";
  const rightPad = after.length > 0 && !/^[\s\n]/.test(after) ? " " : "";
  const inserted = leftPad + token + rightPad;
  return { text: before + inserted + after, cursor: before.length + inserted.length };
}

export function removeSkillToken(text: string, skillName: string): string {
  const key = skillName.toLowerCase();
  const re = new RegExp(SKILL_TOKEN_RE.source, "g");
  return text.replace(re, (full, name: string) => (name.trim().toLowerCase() === key ? "" : full))
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function parseLegacySkillMarkup(text: string): { slash: string | null; names: string[]; body: string } {
  const lines = text.split("\n");
  let slash: string | null = null;
  const first = lines[0] ?? "";
  const slashMatch = first.match(/^\/([^\s]+)(?:[ \t]+(.*))?$/);
  if (slashMatch) {
    slash = slashMatch[1];
    lines[0] = slashMatch[2] ?? "";
  }
  const names: string[] = [];
  const remaining: string[] = [];
  for (const line of lines) {
    const match = line.match(USE_ACTIVE_LINE_RE);
    if (match) {
      names.push(...(match[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean));
      continue;
    }
    remaining.push(line);
  }
  return {
    slash,
    names,
    body: remaining.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""),
  };
}

/** Legacy `/plan` + `use active skills:` plus inline tokens. */
export function allPromptSkillNames(text: string): string[] {
  const parsed = parseLegacySkillMarkup(stripSkillTokens(text));
  const names = [...inlineSkillNames(text), ...parsed.names];
  if (parsed.slash) names.unshift(parsed.slash);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function composeSkillPrompt(text: string): string {
  const names = allPromptSkillNames(text);
  const stripped = stripSkillTokens(text);
  const parsed = parseLegacySkillMarkup(stripped);
  const body = parsed.body.trim();
  const slashSkills = names.filter((name) => getWebSlashCommand(name));
  if (slashSkills.length === 1) {
    const command = slashSkills[0];
    const others = names.filter((name) => name.toLowerCase() !== command.toLowerCase());
    const inner = [others.length ? `use active skills: ${others.join(", ")}` : "", body].filter(Boolean).join("\n\n");
    return inner ? `/${command} ${inner}` : `/${command}`;
  }
  if (names.length > 0) {
    const header = `use active skills: ${names.join(", ")}`;
    return body ? `${header}\n\n${body}` : header;
  }
  return stripped.trim();
}
