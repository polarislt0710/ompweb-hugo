// Project handoff notes: three small markdown files under `<cwd>/.omp/handoff/`
// that let a fresh session pick up where a long one stopped, instead of
// carrying hundreds of thousands of tokens of history forward.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { HANDOFF_DIR, HANDOFF_FILES, type HandoffFileName } from "./handoff-paths";

export { HANDOFF_DIR, HANDOFF_FILES, type HandoffFileName } from "./handoff-paths";

/**
 * Handoff notes are meant to be short; refuse anything that is clearly not.
 *
 * plan.md is the exception: a reviewed plan for a large repository runs to
 * hundreds of tickets. At 256 KiB a 424 KiB plan lost its last forty per cent on
 * read, and the dispatcher then reported the tickets in that tail as unknown
 * rather than as unread — so the cap is generous, and going over it is now said
 * out loud instead of being trimmed away.
 */
export const MAX_HANDOFF_FILE_BYTES = 4 * 1024 * 1024;

export interface HandoffFile {
  name: HandoffFileName;
  /** Path relative to the project root, for @mentions and display. */
  relativePath: string;
  exists: boolean;
  content: string;
  modifiedAt: number | null;
  /** The file was longer than the cap and `content` holds only its start. */
  truncated?: boolean;
}

/**
 * Decode the first `limit` bytes, stepping back off a split character.
 *
 * Cutting mid-sequence would decode to U+FFFD, which is three bytes — so a naive
 * cut can return text that is larger than the budget it was cut to.
 */
function cutToBytes(buffer: Buffer, limit: number): string {
  let end = Math.min(limit, buffer.length);
  // 0b10xxxxxx is a continuation byte: keep walking back to the sequence start.
  while (end > 0 && (buffer[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

export function isHandoffFileName(value: unknown): value is HandoffFileName {
  return typeof value === "string" && (HANDOFF_FILES as readonly string[]).includes(value);
}

export function handoffRelativePath(name: HandoffFileName): string {
  return `${HANDOFF_DIR}/${name}`;
}

export function readHandoffFiles(cwd: string): HandoffFile[] {
  return HANDOFF_FILES.map((name) => {
    const filePath = join(cwd, HANDOFF_DIR, name);
    const relativePath = handoffRelativePath(name);
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) return { name, relativePath, exists: false, content: "", modifiedAt: null };
      const truncated = stat.size > MAX_HANDOFF_FILE_BYTES;
      // Cut by bytes, not by string index: the old `.slice()` counted UTF-16
      // units against a byte budget, so a file of Chinese prose was cut at a
      // different place than the check said.
      const content = truncated
        ? cutToBytes(readFileSync(filePath), MAX_HANDOFF_FILE_BYTES)
        : readFileSync(filePath, "utf8");
      return { name, relativePath, exists: true, content, modifiedAt: stat.mtimeMs, truncated };
    } catch {
      return { name, relativePath, exists: false, content: "", modifiedAt: null };
    }
  });
}

/**
 * Write one handoff file. `isInsideAllowedRoot` receives the real path of the
 * handoff directory so a symlinked `.omp` cannot redirect the write elsewhere.
 */
export function writeHandoffFile(
  cwd: string,
  name: HandoffFileName,
  content: string,
  isInsideAllowedRoot: (realDir: string) => boolean,
): HandoffFile {
  if (Buffer.byteLength(content, "utf8") > MAX_HANDOFF_FILE_BYTES) {
    throw new HandoffError("too_large", `Handoff notes are limited to ${MAX_HANDOFF_FILE_BYTES} bytes`);
  }
  const dir = join(cwd, HANDOFF_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const realDir = realpathSync(dir);
  if (!isInsideAllowedRoot(realDir)) {
    throw new HandoffError("access_denied", "Handoff directory resolves outside the project");
  }
  const filePath = join(realDir, name);
  writeFileSync(filePath, content, "utf8");
  const stat = statSync(filePath);
  return { name, relativePath: handoffRelativePath(name), exists: true, content, modifiedAt: stat.mtimeMs };
}

export class HandoffError extends Error {
  constructor(readonly code: "too_large" | "access_denied", message: string) {
    super(message);
  }
}
