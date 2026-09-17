// Project handoff notes: three small markdown files under `<cwd>/.omp/handoff/`
// that let a fresh session pick up where a long one stopped, instead of
// carrying hundreds of thousands of tokens of history forward.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { HANDOFF_DIR, HANDOFF_FILES, type HandoffFileName } from "./handoff-paths";

export { HANDOFF_DIR, HANDOFF_FILES, type HandoffFileName } from "./handoff-paths";

/** Handoff notes are meant to be short; refuse anything that is clearly not. */
export const MAX_HANDOFF_FILE_BYTES = 256 * 1024;

export interface HandoffFile {
  name: HandoffFileName;
  /** Path relative to the project root, for @mentions and display. */
  relativePath: string;
  exists: boolean;
  content: string;
  modifiedAt: number | null;
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
      const content = stat.size > MAX_HANDOFF_FILE_BYTES
        ? readFileSync(filePath, "utf8").slice(0, MAX_HANDOFF_FILE_BYTES)
        : readFileSync(filePath, "utf8");
      return { name, relativePath, exists: true, content, modifiedAt: stat.mtimeMs };
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
