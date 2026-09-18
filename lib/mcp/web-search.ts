// Web search for the reviewer, through the account the owner already pays for.
//
// omp ships a `search` command that runs the configured provider directly — no
// model, no tokens, just the query and the answer. The owner's first provider is
// Perplexity over OAuth, so a search here costs nothing beyond the subscription
// they already have, and comes back with the sources named.
//
// `focus` exists because the work is Hong Kong exam material: a general web
// search answers with the wrong country's syllabus often enough to be worse than
// no search at all, so the HKDSE focus tells the provider which sources count.

import { spawn } from "child_process";
import { resolveOmpBin } from "../omp/omp-cli";

export class WebSearchError extends Error {}

const SEARCH_TIMEOUT_MS = 90_000;
const MAX_QUERY_CHARS = 400;
const MAX_OUTPUT_CHARS = 20_000;

export const SEARCH_FOCUSES = ["hkdse", "web"] as const;
export type SearchFocus = (typeof SEARCH_FOCUSES)[number];

/**
 * Prepended to the query. Perplexity reads this as part of the question, which
 * is the only steering `omp search` exposes — there is no domain filter flag.
 */
const HKDSE_PREAMBLE = process.env.OMP_WEB_SEARCH_HKDSE_PREAMBLE
  ?? "Answer for Hong Kong's HKDSE only. Prefer official Hong Kong sources — hkeaa.edu.hk, edb.gov.hk, cd.edu.hk — then Hong Kong schools and exam publishers. Ignore UK, US, IB and mainland China syllabuses unless the question asks to compare them. Say so plainly if the official sources do not cover it.";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/**
 * Drop terminal escape sequences. Written as a scan rather than a regular
 * expression so this file carries no control characters of its own: CSI runs to
 * a final byte in @-~, OSC to a BEL or a string terminator.
 */
function stripAnsi(raw: string): string {
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== ESC) {
      out += raw[index];
      continue;
    }
    const kind = raw[index + 1];
    let end = index + 2;
    if (kind === "[") {
      while (end < raw.length && !/[@-~]/.test(raw[end])) end += 1;
    } else if (kind === "]") {
      while (end < raw.length && raw[end] !== BEL && raw[end] !== ESC) end += 1;
      if (raw[end] === ESC) end += 1;
    }
    index = end;
  }
  return out;
}

/** The terminal box `omp search` draws, unwrapped back into plain text. */
export function unwrapSearchOutput(raw: string): string {
  const withoutAnsi = stripAnsi(raw);
  const lines: string[] = [];
  for (const line of withoutAnsi.split("\n")) {
    const trimmed = line.replace(/\s+$/, "");
    const rule = /^[╭╰├└](.*)[╮╯┤┘]$/.exec(trimmed);
    if (rule && !trimmed.includes("│")) {
      // A section rule: keep its label ("─── Sources ───") and drop the line.
      const label = /─{2,}\s*([^─]+?)\s*─{2,}/.exec(rule[1])?.[1];
      if (label) lines.push(`\n## ${label}`);
      continue;
    }
    const boxed = /^│(.*)│$/.exec(trimmed);
    // The box pads every line with one space; keep deeper indentation, which
    // carries the nesting of the answer's bullet lists.
    lines.push(boxed ? boxed[1].replace(/^ /, "").replace(/\s+$/, "") : trimmed);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      // A search must not pick up a project's environment or working directory.
      cwd: process.env.HOME || "/",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new WebSearchError("The search took too long and was stopped."));
    }, SEARCH_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(new WebSearchError(`Could not run omp search: ${error.message}`)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
  });
}

export interface WebSearchOptions {
  focus?: unknown;
  recency?: unknown;
  limit?: unknown;
  provider?: unknown;
}

export interface WebSearchResult {
  text: string;
  provider: string;
  query: string;
}

export async function searchWeb(rawQuery: unknown, options: WebSearchOptions = {}): Promise<WebSearchResult> {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) throw new WebSearchError("query is required");
  if (query.length > MAX_QUERY_CHARS) throw new WebSearchError(`query must be at most ${MAX_QUERY_CHARS} characters`);

  const bin = resolveOmpBin();
  if (!bin) throw new WebSearchError("omp is not installed on this machine, so web search is unavailable.");

  const focus: SearchFocus = options.focus === "web" ? "web" : "hkdse";
  const provider = typeof options.provider === "string" && /^[a-z0-9-]{1,30}$/i.test(options.provider)
    ? options.provider
    : process.env.OMP_WEB_SEARCH_PROVIDER || "perplexity";
  const limit = Math.min(10, Math.max(1, typeof options.limit === "number" ? Math.round(options.limit) : 5));

  const args = ["search", "--provider", provider, "-l", String(limit)];
  const recency = typeof options.recency === "string" ? options.recency.trim().toLowerCase() : "";
  if (/^(hour|day|week|month|year)$/.test(recency)) args.push("--recency", recency);
  // `omp search` takes the query as trailing words, so a leading dash would be
  // read as a flag.
  const asked = focus === "hkdse" ? `${HKDSE_PREAMBLE}\n\nQuestion: ${query}` : query.replace(/^-+/, "");
  args.push(asked);

  const { stdout, stderr, code } = await run(bin, args);
  // The provider echoes the question it was given, preamble and all, which is
  // noise in the reply. Show what was actually asked instead.
  const text = unwrapSearchOutput(stdout)
    .split("\n")
    .filter((line) => !line.startsWith("Query:"))
    .join("\n")
    .replace(/^\n+/, "");
  if (!text) {
    const detail = unwrapSearchOutput(stderr).slice(0, 500);
    throw new WebSearchError(code === 0
      ? "The search returned nothing."
      : `The search failed${detail ? `: ${detail}` : ` (exit ${code})`}. Check that the provider is still signed in with \`omp usage\`.`);
  }
  const body = `Query: ${query}${focus === "hkdse" ? " (HKDSE sources)" : ""}\n${text}`;
  return {
    text: body.length > MAX_OUTPUT_CHARS ? `${body.slice(0, MAX_OUTPUT_CHARS)}\n… truncated` : body,
    provider,
    query,
  };
}
