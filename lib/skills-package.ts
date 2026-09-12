/**
 * skills.sh `add` sources are GitHub shorthand (`owner/repo[@skill]`), not npm
 * names. The installer used to reject anything with `/` unless it was `@scope/pkg`,
 * which is why OpenAI / Anthropic marketplace skills showed "Invalid package name".
 */

export interface SkillsAddPackage {
  source: string;
  skill?: string;
}

const UNSAFE = /[\n\r;|$`\\<>]/;
const NPM_SCOPED = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
const NPM_UNSCOPED = /^[a-z0-9][a-z0-9._-]*$/i;
const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const GIT_REF = /^[A-Za-z0-9._/-]+$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}$/;

export function parseSkillsAddPackage(raw: string): SkillsAddPackage | null {
  const name = raw.trim();
  if (!name || name.length > 256 || name.startsWith("-") || UNSAFE.test(name)) return null;

  if (name.startsWith("@")) {
    return NPM_SCOPED.test(name) ? { source: name } : null;
  }

  let source = name;
  let skill: string | undefined;
  const at = name.lastIndexOf("@");
  if (at > 0) {
    source = name.slice(0, at);
    skill = name.slice(at + 1).trim();
    if (!skill) return null;
  }

  if (!source.includes("/")) {
    return !skill && NPM_UNSCOPED.test(source) ? { source } : null;
  }

  const [repo, ref] = source.split("#");
  if (!GITHUB_REPO.test(repo)) return null;
  if (ref !== undefined && !GIT_REF.test(ref)) return null;
  if (skill !== undefined && !SKILL_NAME.test(skill)) return null;
  return skill ? { source, skill } : { source };
}

export function skillsAddArgs(pkg: SkillsAddPackage, options: { global: boolean }): string[] {
  const args = ["skills", "add", pkg.source, "-y", "--agent", "universal"];
  if (pkg.skill) args.push("--skill", pkg.skill);
  if (options.global) args.push("-g");
  return args;
}
