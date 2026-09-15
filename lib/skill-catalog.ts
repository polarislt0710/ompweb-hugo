import { skillUsageBoost, skillUsageCount, type SkillUsageMap } from "./skill-usage";
import { stripSkillTokens } from "./skill-tokens";

/**
 * Composer skill catalog: group discovered skills into Dev / Design / Daily,
 * insert a picked skill into the prompt (never auto-send), and score idle-prompt
 * suggestions. Suggestions stay visual-only until the user confirms them twice.
 */

export const SKILL_CATEGORIES = ["dev", "design", "daily"] as const;
export type SkillCategoryId = (typeof SKILL_CATEGORIES)[number];

export type CatalogSkillKind = "slash" | "skill";

export interface CatalogSkill {
  name: string;
  description: string;
  category: SkillCategoryId;
  kind: CatalogSkillKind;
  dormant?: boolean;
}

export const SUGGESTION_IDLE_MS = 1500;
export const SUGGESTION_MIN_CHARS = 8;
export const SUGGESTION_LIMIT = 3;
export const SUGGESTION_SCORE_FLOOR = 3;

const USE_ACTIVE_LINE_RE = /^use active skills:\s*(.*)$/i;

/** Web slash commands that used to be dedicated composer toggles, plus close cousins. */
export const WORKFLOW_CATALOG_SKILLS: readonly CatalogSkill[] = [
  { name: "plan", description: "Create a step-by-step plan before editing", category: "dev", kind: "slash" },
  { name: "flow", description: "Grill then spec, tickets, and implement", category: "dev", kind: "slash" },
  { name: "grill", description: "Interview only, one question at a time", category: "dev", kind: "slash" },
  { name: "ask-matt", description: "Ask which engineering step to run", category: "dev", kind: "slash" },
  { name: "review", description: "Review project state and recent changes", category: "dev", kind: "slash" },
  { name: "fix", description: "Fix a reported issue", category: "dev", kind: "slash" },
  { name: "test", description: "Write and run tests", category: "dev", kind: "slash" },
  { name: "simplify", description: "Simplify code while preserving behavior", category: "dev", kind: "slash" },
  { name: "commit", description: "Stage and commit the current changes", category: "dev", kind: "slash" },
  { name: "advisor", description: "Independent advisory review of the work", category: "dev", kind: "slash" },
  { name: "loop", description: "Repeat a task until it is done", category: "dev", kind: "slash" },
  { name: "wait-what", description: "Re-pitch the last answer in plainer words", category: "daily", kind: "slash" },
  { name: "explain", description: "Explain code or a concept", category: "daily", kind: "slash" },
];

const DESIGN_PREFIXES = [
  "hyperframes",
  "motion-graphics",
  "media-use",
  "general-video",
  "vimo-",
  "impeccable",
  "brand-ui",
  "taste-skill",
  "web-motion",
  "game-",
  "gpt-image",
  "archify",
  "tldraw",
  "remotion",
  "video-",
  "aia-",
  "ig-story",
  "heygen",
  "gemini-video",
  "edge-tts",
  "runcomfy",
  "prompt-to-brief",
  "original-cantonese",
  "improve-animations",
];

const DESIGN_EXACT = new Set(["design", "imagine", "archify", "tldraw-offline"]);

const DEV_PREFIXES = [
  "grill",
  "matt-flow",
  "to-spec",
  "to-tickets",
  "code-",
  "codebase",
  "diagnos",
  "engineer",
  "implement",
  "tdd",
  "webapp-test",
  "test-app",
  "resolving-merge",
  "vercel-composition",
  "agent-harness",
  "awesome-code",
  "cli-anything",
  "domain-model",
  "duckdb",
  "sql-",
  "validate-data",
  "writing-great-skills",
  "create-skill",
  "create-workflow",
  "execute-plan",
  "pr-babysit",
  "long-running",
  "resume-",
  "build-with-ai",
  "skill-design",
  "setup-matt",
  "advise-project",
  "project-lifecycle",
  "artifacts-builder",
  "ai-prompt",
  "improve-codebase",
  "antigravity",
];

const DEV_EXACT = new Set([
  "plan",
  "flow",
  "ask-matt",
  "review",
  "fix",
  "test",
  "simplify",
  "commit",
  "advisor",
  "loop",
  "prototype",
  "triage",
  "wayfinder",
  "handoff",
  "memory-continuity",
  "statusline",
  "implement",
]);

const DAILY_PREFIXES = [
  "wait-what",
  "research",
  "humanizer",
  "cantonese",
  "file-organizer",
  "neuroarxiv",
  "ig-growth",
  "brainstorm",
  "docx",
  "pptx",
  "google-workspace",
  "gcloud",
];

const DAILY_EXACT = new Set([
  "wait-what",
  "teach",
  "explain",
  "learn",
  "pdf",
  "docx",
  "pptx",
  "goal",
  "gcloud",
]);

function matchesPrefix(name: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => name === prefix || name.startsWith(prefix));
}

export function classifySkill(name: string, description = ""): SkillCategoryId {
  const n = name.trim().toLowerCase();
  if (!n) return "daily";
  if (DESIGN_EXACT.has(n) || matchesPrefix(n, DESIGN_PREFIXES)) return "design";
  if (DEV_EXACT.has(n) || matchesPrefix(n, DEV_PREFIXES)) return "dev";
  if (DAILY_EXACT.has(n) || matchesPrefix(n, DAILY_PREFIXES)) return "daily";

  const d = description.toLowerCase();
  const looksDesign = /(video|animation|motion|visual|image|brand|design system|illustration|typography)/.test(d);
  const looksDev = /(code|implement|review|test|debug|architecture|refactor|git|typescript|api)/.test(d);
  if (looksDesign && !looksDev) return "design";
  if (looksDev) return "dev";
  return "daily";
}

export function catalogSkillFromDiscovered(skill: {
  name: string;
  description?: string;
  disableModelInvocation?: boolean;
}): CatalogSkill {
  const name = skill.name.trim();
  const description = skill.description?.trim() ?? "";
  return {
    name,
    description,
    category: classifySkill(name, description),
    kind: "skill",
    dormant: skill.disableModelInvocation === true,
  };
}

export function mergeCatalogSkills(discovered: CatalogSkill[]): CatalogSkill[] {
  const byName = new Map<string, CatalogSkill>();
  for (const skill of WORKFLOW_CATALOG_SKILLS) {
    byName.set(skill.name.toLowerCase(), { ...skill });
  }
  for (const skill of discovered) {
    const key = skill.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, skill);
      continue;
    }
    byName.set(key, {
      ...existing,
      description: skill.description || existing.description,
      dormant: skill.dormant ?? existing.dormant,
      // Keep slash kind when a workflow command also exists as a file skill.
      kind: existing.kind === "slash" ? "slash" : skill.kind,
      category: existing.kind === "slash" ? existing.category : skill.category,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function skillsInCategory(
  skills: readonly CatalogSkill[],
  category: SkillCategoryId,
  usage: SkillUsageMap = {},
): CatalogSkill[] {
  return skills
    .filter((skill) => skill.category === category)
    .sort((a, b) => {
      const usageDelta = skillUsageCount(usage, b.name) - skillUsageCount(usage, a.name);
      if (usageDelta !== 0) return usageDelta;
      return a.name.localeCompare(b.name);
    });
}

export function promptSkillNames(text: string): string[] {
  const parsed = parsePromptSkills(text);
  const names = [...parsed.activeSkills];
  if (parsed.slash) names.unshift(parsed.slash);
  return uniqueSkillNames(names);
}

export interface ParsedPromptSkills {
  slash: string | null;
  activeSkills: string[];
  body: string;
}

function splitActiveSkillNames(raw: string): string[] {
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

export function parsePromptSkills(text: string): ParsedPromptSkills {
  const lines = text.split("\n");
  let slash: string | null = null;
  const first = lines[0] ?? "";
  const slashMatch = first.match(/^\/([^\s]+)(?:[ \t]+(.*))?$/);
  if (slashMatch) {
    slash = slashMatch[1];
    lines[0] = slashMatch[2] ?? "";
  }

  const activeSkills: string[] = [];
  const remaining: string[] = [];
  for (const line of lines) {
    const match = line.match(USE_ACTIVE_LINE_RE);
    if (match) {
      activeSkills.push(...splitActiveSkillNames(match[1] ?? ""));
      continue;
    }
    remaining.push(line);
  }

  return {
    slash,
    activeSkills: uniqueSkillNames(activeSkills),
    body: remaining.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""),
  };
}

function uniqueSkillNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function formatPromptSkills(parsed: ParsedPromptSkills): string {
  const skillLine = parsed.activeSkills.length > 0
    ? `use active skills: ${parsed.activeSkills.join(", ")}`
    : "";
  if (parsed.slash) {
    const slashLine = parsed.body ? `/${parsed.slash} ${parsed.body}` : `/${parsed.slash} `;
    return skillLine ? `${slashLine}\n\n${skillLine}` : slashLine;
  }
  if (skillLine && parsed.body) return `${skillLine}\n\n${parsed.body}`;
  return skillLine || parsed.body;
}

function namesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function promptMentionsSkill(text: string, skillName: string): boolean {
  const parsed = parsePromptSkills(text);
  if (parsed.slash && namesEqual(parsed.slash, skillName)) return true;
  return parsed.activeSkills.some((name) => namesEqual(name, skillName));
}

export function insertSkillIntoPrompt(text: string, skill: Pick<CatalogSkill, "name" | "kind">): string {
  const parsed = parsePromptSkills(text);
  if (skill.kind === "slash") {
    parsed.slash = skill.name;
  } else if (!parsed.activeSkills.some((name) => namesEqual(name, skill.name))) {
    parsed.activeSkills = [...parsed.activeSkills, skill.name];
  }
  return formatPromptSkills(parsed);
}

export function removeSkillFromPrompt(text: string, skill: Pick<CatalogSkill, "name" | "kind">): string {
  const parsed = parsePromptSkills(text);
  if (skill.kind === "slash" && parsed.slash && namesEqual(parsed.slash, skill.name)) {
    parsed.slash = null;
  }
  parsed.activeSkills = parsed.activeSkills.filter((name) => !namesEqual(name, skill.name));
  return formatPromptSkills(parsed);
}

export function promptBodyForSuggestions(text: string): string {
  return parsePromptSkills(stripSkillTokens(text)).body.trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff+]+/i)
    .filter((token) => token.length >= 2);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-ish match for Latin; substring match for CJK (`\\b` does not fire between CJK). */
function promptHasNeedle(prompt: string, needle: string): boolean {
  if (!needle) return false;
  if (/[\u4e00-\u9fff]/.test(needle)) return prompt.includes(needle);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, "i").test(prompt);
}

const INTENT_BOOSTS: Array<{ needles: string[]; names: string[]; score: number }> = [
  { needles: ["plan", "planning", "architecture", "structure", "analyze", "analysis", "規劃", "計劃", "架構", "結構", "分析", "點樣", "tenant", "account"], names: ["plan", "explain", "ask-matt", "domain-modeling"], score: 8 },
  { needles: ["grill", "interview", "問清楚", "需求", "釐清"], names: ["grill", "ask-matt"], score: 8 },
  { needles: ["flow", "spec", "ticket", "規格", "實作"], names: ["flow", "to-spec", "to-tickets"], score: 6 },
  { needles: ["review", "檢查", "審查"], names: ["review", "code-review"], score: 7 },
  { needles: ["test", "tdd", "測試"], names: ["test", "tdd", "webapp-testing"], score: 6 },
  { needles: ["fix", "bug", "修", "壞咗"], names: ["fix", "diagnosing-bugs"], score: 6 },
  { needles: ["video", "影片", "剪片", "vimo", "hyperframes", "motion"], names: ["vimo-video-editing", "hyperframes", "media-use", "motion-graphics"], score: 8 },
  { needles: ["image", "design", "brand", "圖", "設計"], names: ["imagine", "impeccable-design", "brand-ui", "design"], score: 6 },
  { needles: ["wait-what", "聽唔明", "re-pitch", "再講"], names: ["wait-what"], score: 8 },
  { needles: ["explain", "解釋", "講解", "幫我睇"], names: ["explain", "ask-matt"], score: 7 },
];

const FALLBACK_SUGGESTION_NAMES = ["plan", "ask-matt", "explain"];

export function scoreSkillForPrompt(prompt: string, skill: CatalogSkill): number {
  const haystack = prompt.toLowerCase();
  const tokens = tokenize(prompt);
  const name = skill.name.toLowerCase();
  const desc = skill.description.toLowerCase();
  let score = 0;

  for (const part of name.split(/[-_]/)) {
    if (part.length < 3) continue;
    if (tokens.includes(part)) score += 5;
    else if (haystack.includes(part)) score += 2;
  }

  for (const token of tokens) {
    if (token.length >= 4 && desc.includes(token)) score += 1;
  }

  for (const boost of INTENT_BOOSTS) {
    if (!boost.needles.some((needle) => promptHasNeedle(prompt, needle))) continue;
    if (boost.names.some((candidate) => namesEqual(candidate, skill.name))) score += boost.score;
  }

  return score;
}

function fallbackSuggestions(
  prompt: string,
  skills: readonly CatalogSkill[],
  limit: number,
  usage: SkillUsageMap,
): CatalogSkill[] {
  const available = skills.filter((skill) => !skill.dormant && !promptMentionsSkill(prompt, skill.name));
  const byUsage = [...available].sort((a, b) => {
    const usageDelta = skillUsageCount(usage, b.name) - skillUsageCount(usage, a.name);
    if (usageDelta !== 0) return usageDelta;
    return a.name.localeCompare(b.name);
  });
  const picked: CatalogSkill[] = [];
  const take = (skill: CatalogSkill | undefined) => {
    if (!skill || picked.some((entry) => entry.name.toLowerCase() === skill.name.toLowerCase())) return;
    picked.push(skill);
  };
  for (const skill of byUsage) {
    if (skillUsageCount(usage, skill.name) <= 0) break;
    take(skill);
    if (picked.length >= limit) return picked;
  }
  const byName = new Map(available.map((skill) => [skill.name.toLowerCase(), skill]));
  for (const name of FALLBACK_SUGGESTION_NAMES) {
    take(byName.get(name));
    if (picked.length >= limit) break;
  }
  return picked;
}

export function suggestSkills(
  prompt: string,
  skills: readonly CatalogSkill[],
  options?: { limit?: number; minChars?: number; usage?: SkillUsageMap },
): CatalogSkill[] {
  const limit = options?.limit ?? SUGGESTION_LIMIT;
  const minChars = options?.minChars ?? SUGGESTION_MIN_CHARS;
  const usage = options?.usage ?? {};
  const body = promptBodyForSuggestions(prompt);
  if (body.length < minChars) return [];

  const candidates = skills
    .filter((skill) => !skill.dormant && !promptMentionsSkill(prompt, skill.name))
    .map((skill) => {
      const intent = scoreSkillForPrompt(body, skill);
      return {
        skill,
        intent,
        score: intent + skillUsageBoost(usage, skill.name),
      };
    });

  const ranked = candidates
    .filter((entry) => entry.intent >= SUGGESTION_SCORE_FLOOR)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .map((entry) => entry.skill);

  const picked: CatalogSkill[] = [];
  const seen = new Set<string>();
  const take = (skill: CatalogSkill | undefined) => {
    if (!skill) return;
    const key = skill.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(skill);
  };
  for (const skill of ranked) {
    take(skill);
    if (picked.length >= limit) return picked;
  }

  // Frequent skills get a spare slot when they are at least weakly on-topic.
  const frequent = [...candidates]
    .filter((entry) => entry.intent >= 1 && skillUsageCount(usage, entry.skill.name) > 0)
    .sort((a, b) => skillUsageCount(usage, b.skill.name) - skillUsageCount(usage, a.skill.name)
      || b.score - a.score);
  for (const entry of frequent) {
    take(entry.skill);
    if (picked.length >= limit) return picked;
  }

  if (picked.length > 0) return picked;
  return fallbackSuggestions(prompt, skills, limit, usage);
}
