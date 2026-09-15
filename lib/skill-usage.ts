/**
 * How often the owner has used a composer skill. Client-only (localStorage),
 * because this is ompweb ranking, not an omp engine setting.
 */

export const SKILL_USAGE_STORAGE_KEY = "omp-web:skill-usage";

export type SkillUsageMap = Record<string, number>;

function isUsageMap(value: unknown): value is SkillUsageMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((count) => typeof count === "number" && Number.isFinite(count) && count >= 0);
}

export function normalizeSkillUsageName(name: string): string {
  return name.trim().toLowerCase();
}

export function readSkillUsage(): SkillUsageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SKILL_USAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!isUsageMap(parsed)) return {};
    const out: SkillUsageMap = {};
    for (const [name, count] of Object.entries(parsed)) {
      const key = normalizeSkillUsageName(name);
      if (!key) continue;
      out[key] = Math.floor(count);
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSkillUsage(usage: SkillUsageMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SKILL_USAGE_STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // private mode / quota
  }
}

export function skillUsageCount(usage: SkillUsageMap, name: string): number {
  return usage[normalizeSkillUsageName(name)] ?? 0;
}

/** log1p so a handful of uses matter, but a favourite cannot bury a clear prompt match. */
export function skillUsageBoost(usage: SkillUsageMap, name: string, weight = 2.5): number {
  return Math.log1p(skillUsageCount(usage, name)) * weight;
}

export function incrementSkillUsage(names: readonly string[], current?: SkillUsageMap): SkillUsageMap {
  const next: SkillUsageMap = { ...(current ?? readSkillUsage()) };
  let changed = false;
  for (const name of names) {
    const key = normalizeSkillUsageName(name);
    if (!key) continue;
    next[key] = (next[key] ?? 0) + 1;
    changed = true;
  }
  if (changed) writeSkillUsage(next);
  return next;
}
